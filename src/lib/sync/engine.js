// The sync algorithm: a three-way comparison per item between this device
// (local), what this device last synced (base) and the server (remote).
//
//   remote moved on, local didn't   -> take remote (write or delete here)
//   local moved on, remote didn't   -> upload (with base revision; the server
//                                      rejects it if someone got there first)
//   both moved on, same content     -> nothing to do
//   both moved on, different        -> conflict: the player chooses per item
//
// Deletions are tombstones with their own revision, so an old device that
// reconnects sees "deleted after the version you have" and deletes too,
// instead of uploading the item again.
//
// Archived attempts are immutable: an archive is only ever created or
// deleted, never replaced, here and on the server. Run data is never written
// for an archived attempt.
//
// Planning functions are pure; `syncCycle` does the I/O through injected
// `api` (see ./api.js) and `storage`, so it runs the same in node tests.
import { readLocal, applyChanges, validateItem, hashItem, canonical, isBlocked, copyItems, describeItem, SyncError, KEYCHECK_ID } from './items.js'
import { encryptItem, decryptItem } from './crypto.js'
import { loadState, saveState } from './state.js'
import { kindOf, refOf, LIMITS } from './protocol.js'
import { summarizeAttempt } from '../history/archive.js'

const MAX_ROUNDS = 5
const MAX_PAGES = 100

/**
 * Classifies items received from the server.
 * @param remote [{ id, rev, value|null, hash|null, invalid? }]
 * @param base { [id]: { rev, hash } }
 * @param local { items, blocked } from readLocal
 * @param localHashes { [id]: hash }
 * @returns {{ apply, ack, conflicts, hold }} apply/ack/hold: [{ id, rev, value?, hash? }]
 */
export function planIncoming({ remote, base, local, localHashes }) {
  const latest = new Map()
  for (const r of remote) if (!latest.has(r.id) || latest.get(r.id).rev < r.rev) latest.set(r.id, r)

  const apply = new Map()
  const ack = []
  const conflicts = new Map()
  const hold = []
  const conflict = (r, reason) => conflicts.set(r.id, { id: r.id, rev: r.rev, remote: r.value, hash: r.hash, reason })

  for (const r of latest.values()) {
    const b = base[r.id]
    if (b && b.rev === r.rev) continue
    if (isBlocked(local.blocked, r.id)) {
      hold.push({ id: r.id, rev: r.rev, reason: 'unreadable-here' })
      continue
    }
    if (r.invalid) {
      conflict(r, 'invalid')
      continue
    }
    const lh = localHashes[r.id] ?? null
    if (lh === r.hash) {
      ack.push({ id: r.id, rev: r.rev, hash: r.hash })
      continue
    }
    const localChanged = lh !== (b ? b.hash : null)
    // Never replace an archive this device already has with different data
    if (kindOf(r.id) === 'archive' && r.value && lh !== null) conflict(r, 'archive-differs')
    else if (localChanged) conflict(r, 'both-changed')
    else apply.set(r.id, r)
  }

  const has = (id) => !!local.items[id] || !!apply.get(id)?.value
  for (const r of [...apply.values()]) {
    const kind = kindOf(r.id)
    const ref = refOf(r.id)
    if (kind === 'archive' && r.value && local.items[`run:${ref}`]) {
      // Archived on another device while this device has the run active.
      // The run goes only together with its received deletion, never while
      // this device has unsynced changes to it.
      const runId = `run:${ref}`
      const runDeletion = apply.get(runId)
      if (!(runDeletion && runDeletion.value === null)) {
        apply.delete(r.id)
        hold.push({ id: r.id, rev: r.rev, reason: 'run-in-conflict' })
        const meta = apply.get(`archmeta:${ref}`)
        if (meta) {
          apply.delete(meta.id)
          hold.push({ id: meta.id, rev: meta.rev, reason: 'run-in-conflict' })
        }
        // The only safe outcomes now: accept the archive, or keep this
        // device's run under a new id
        const c = conflicts.get(runId)
        if (c) c.reason = 'archived-elsewhere'
        else conflicts.set(runId, { id: runId, rev: base[runId]?.rev ?? 0, remote: null, hash: null, reason: 'archived-elsewhere' })
      }
    } else if (kind === 'run' && r.value && has(`archive:${ref}`)) {
      apply.delete(r.id)
      conflict(r, 'archived')
    } else if (kind === 'attempt' && r.value && has(`archive:${ref}`)) {
      apply.delete(r.id)
      ack.push({ id: r.id, rev: r.rev, hash: r.hash }) // progress of an archived attempt lives in the archive
    } else if (kind === 'archmeta' && r.value && !has(`archive:${ref}`)) {
      apply.delete(r.id)
      hold.push({ id: r.id, rev: r.rev, reason: 'archive-missing' })
    }
  }

  return { apply: [...apply.values()], ack, conflicts: [...conflicts.values()], hold }
}

/**
 * Items this device needs to upload: changed since last sync, or deleted
 * (tombstone). Skips anything unreadable, in conflict or held back.
 * @returns [{ id, base, value|null, hash|null }]
 */
export function planOutgoing({ local, localHashes, base, skip = new Set() }) {
  const out = []
  const blocked = (id) => skip.has(id) || isBlocked(local.blocked, id)
  for (const [id, value] of Object.entries(local.items)) {
    if (blocked(id)) continue
    const b = base[id]
    if (b && b.hash === localHashes[id]) continue
    // An archive this device already synced can't change; never try to replace it
    if (kindOf(id) === 'archive' && b && b.hash !== null) continue
    out.push({ id, base: b ? b.rev : 0, value, hash: localHashes[id] })
  }
  for (const [id, b] of Object.entries(base)) {
    if (id in local.items || b.hash === null || blocked(id) || id === KEYCHECK_ID) continue
    out.push({ id, base: b.rev, value: null, hash: null })
  }
  return out
}

/**
 * What the player may choose for a conflict.
 *   local:  this device's state wins (uploaded over the server's)
 *   remote: the other devices' state wins (written here)
 *   copy:   keep both - the version that would be lost is saved under a new id
 */
export function conflictChoices(c, local) {
  const kind = kindOf(c.id)
  const ref = refOf(c.id)
  const here = c.id in local.items
  if (c.reason === 'invalid') return ['local']
  if (c.reason === 'archived-elsewhere') return ['remote', 'copy']
  if (kind === 'archive') return here && c.remote ? ['copy'] : ['local', 'remote']
  if (kind === 'run') {
    if (c.remote && local.items[`archive:${ref}`]) return ['local', 'copy']
    if (here && c.remote) return ['local', 'remote', 'copy']
  }
  return ['local', 'remote']
}

/** Turns a decision into item writes and base updates */
export function resolveConflict(c, choice, local, newId) {
  if (!conflictChoices(c, local).includes(choice)) throw new SyncError('bad-choice', `That choice isn’t available for ${c.id}.`)
  const ref = refOf(c.id)
  const settled = { [c.id]: { rev: c.rev, hash: c.reason === 'invalid' ? 'invalid' : c.hash } }
  if (choice === 'local') return { apply: [], base: settled, replaceArchives: [] }
  if (choice === 'remote') return { apply: [{ id: c.id, value: c.remote }], base: settled, replaceArchives: [] }

  const kind = kindOf(c.id)
  const mine = local.items[c.id]
  if (kind === 'archive') {
    const copies = copyItems(c.id, mine, local.items[`archmeta:${ref}`], newId(), 'this device')
    return { apply: [...copies, { id: c.id, value: c.remote }], base: settled, replaceArchives: [ref] }
  }
  if (c.remote && local.items[`archive:${ref}`]) {
    // Edited elsewhere after it was archived here: keep those edits as a new run
    return { apply: copyItems(c.id, c.remote, null, newId(), 'from another device'), base: settled, replaceArchives: [] }
  }
  // Keep this device's run as a new run, take the other version under this id
  const copies = copyItems(c.id, mine, local.items[`attempt:${ref}`], newId(), 'copy')
  return { apply: [...copies, { id: c.id, value: c.remote }], base: settled, replaceArchives: [] }
}

// ---- I/O

async function hashAll(items) {
  const out = {}
  for (const [id, value] of Object.entries(items)) out[id] = await hashItem(value, id)
  return out
}

/** Pulls every change after `since`, page by page */
async function pullAll(api, since, epoch) {
  const items = []
  let cursor = since
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await api.pull({ since: cursor })
    if (res.epoch !== epoch) throw new SyncError('epoch-changed', 'The synced data was reset from another device. Reconnect this device to continue syncing.')
    items.push(...res.items)
    cursor = res.next
    if (!res.more) return { items, head: res.head }
  }
  throw new SyncError('too-many-pages', 'Too much data changed at once. Try again.')
}

async function openItems(key, epoch, pulled) {
  const out = []
  // The key check first, so a wrong key is reported as such
  const ordered = [...pulled].sort((a, b) => (b.id === KEYCHECK_ID) - (a.id === KEYCHECK_ID))
  for (const p of ordered) {
    if (p.ct === null) {
      out.push({ id: p.id, rev: p.rev, value: null, hash: null })
      continue
    }
    let raw
    try {
      raw = await decryptItem(key, epoch, p.id, p.ct)
    } catch (e) {
      if (p.id === KEYCHECK_ID) throw new SyncError('wrong-key', 'This device’s encryption key doesn’t match the synced data. Reconnect with a pairing code or the recovery key.', e)
      throw e
    }
    try {
      const value = validateItem(p.id, raw)
      out.push({ id: p.id, rev: p.rev, value, hash: await hashItem(value, p.id), rawHash: await hashItem(raw, p.id) })
    } catch (e) {
      out.push({ id: p.id, rev: p.rev, value: null, hash: null, invalid: true, error: e.message })
    }
  }
  return out
}

/**
 * One full sync: pull, reconcile, write here, upload, read back to verify -
 * repeated until there is nothing left to upload.
 *
 * @param ctx { storage, api, key (CryptoKey), newId(), now() }
 * @param opts.dryRun    plan only and return a preview; writes nothing
 * @param opts.decisions { [itemId]: 'local' | 'remote' | 'copy' } for conflicts
 * @param opts.onApplied (ids) called after items from other devices were written here
 * @returns {{ conflicts, applied, uploaded, preview? }}
 */
export async function syncCycle(ctx, { dryRun = false, decisions = {}, onApplied = () => {} } = {}) {
  const { storage, api, key, newId, now } = ctx
  const state = loadState(storage)
  if (!state.config?.token || !state.config.epoch) throw new SyncError('not-connected', 'This device isn’t connected.')
  let { config, base, conflicts } = state
  let verify = null
  const totals = { applied: [], uploaded: 0 }

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const pulled = await pullAll(api, config.cursor, config.epoch)
    const remote = await openItems(key, config.epoch, pulled.items)

    if (verify) {
      // Read back what was just uploaded: same revision, same content
      for (const [id, hash] of Object.entries(verify.items)) {
        const got = remote.filter((r) => r.id === id).sort((a, b) => b.rev - a.rev)[0]
        if (got && got.rev > verify.rev) continue // already changed again elsewhere
        if (!got || got.rev !== verify.rev || (got.rawHash ?? got.hash) !== hash)
          throw new SyncError('verify-failed', 'The server did not return what this device uploaded. Nothing more was changed; try again.')
      }
      verify = null
    }

    let local = readLocal(storage)
    let localHashes = await hashAll(local.items)
    const plan = planIncoming({ remote, base, local, localHashes })

    // Keep earlier unresolved conflicts unless this pull replaced them or
    // both sides now agree
    const byId = new Map(conflicts.map((c) => [c.id, c]))
    for (const c of plan.conflicts) byId.set(c.id, { ...c, at: now() })
    for (const a of plan.apply.concat(plan.ack)) byId.delete(a.id)
    for (const c of byId.values()) {
      if (c.reason !== 'invalid' && (localHashes[c.id] ?? null) === c.hash) {
        byId.delete(c.id)
        plan.ack.push({ id: c.id, rev: c.rev, hash: c.hash })
      }
    }

    if (dryRun) return { preview: buildPreview(plan, [...byId.values()], local, localHashes, base), conflicts: [...byId.values()] }

    // Decisions the player already made
    const changes = plan.apply.map((r) => ({ id: r.id, value: r.value }))
    const nextBase = { ...base }
    const replaceArchives = []
    for (const c of [...byId.values()]) {
      const choice = decisions[c.id]
      if (!choice) continue
      const r = resolveConflict(c, choice, local, newId)
      changes.push(...r.apply)
      replaceArchives.push(...r.replaceArchives)
      Object.assign(nextBase, r.base)
      byId.delete(c.id)
    }

    // The player may have edited something while this ran: leave those for
    // the next round rather than overwrite them
    const fresh = readLocal(storage)
    const hold = [...plan.hold]
    const safe = changes.filter((c) => {
      if (canonical(local.items[c.id] ?? null) === canonical(fresh.items[c.id] ?? null)) return true
      const r = plan.apply.find((a) => a.id === c.id)
      if (r) hold.push({ id: r.id, rev: r.rev, reason: 'edited-meanwhile' })
      return false
    })

    if (safe.length) {
      const result = applyChanges(storage, safe, { replaceArchives })
      for (const s of result.skipped) {
        const r = plan.apply.find((a) => a.id === s.id)
        if (r) hold.push({ id: r.id, rev: r.rev, reason: s.reason })
      }
      const done = new Set(result.applied)
      for (const r of plan.apply) if (done.has(r.id)) nextBase[r.id] = { rev: r.rev, hash: r.hash }
      totals.applied.push(...result.applied)
    }
    for (const a of plan.ack) nextBase[a.id] = { rev: a.rev, hash: a.hash }

    base = nextBase
    conflicts = [...byId.values()]
    const heldBack = hold.filter((h) => !(h.id in nextBase) || nextBase[h.id].rev !== h.rev)
    config = { ...config, cursor: heldBack.length ? Math.max(0, Math.min(...heldBack.map((h) => h.rev)) - 1) : pulled.head }
    saveState(storage, { config, base, conflicts })
    if (safe.length) onApplied(totals.applied)

    // Upload what changed here
    local = readLocal(storage)
    localHashes = await hashAll(local.items)
    const skip = new Set([...conflicts.map((c) => c.id), ...heldBack.map((h) => h.id)])

    // An already-synced archive that differs here (e.g. replaced by a backup
    // restore) can't be uploaded - archives are never replaced. Forget its
    // sync state and read the synced copy again, so it shows up as an
    // "archived on two devices" conflict instead of silently diverging.
    const diverged = Object.keys(local.items).filter(
      (id) => kindOf(id) === 'archive' && !skip.has(id) && !isBlocked(local.blocked, id) && base[id] && base[id].hash !== null && base[id].hash !== localHashes[id]
    )
    if (diverged.length) {
      config = { ...config, cursor: Math.max(0, Math.min(config.cursor, ...diverged.map((id) => base[id].rev - 1))) }
      for (const id of diverged) delete base[id]
      saveState(storage, { config, base, conflicts })
      continue
    }

    const outgoing = planOutgoing({ local, localHashes, base, skip })
    if (!outgoing.length) {
      config = { ...config, lastSyncedAt: now() }
      saveState(storage, { config, base, conflicts })
      return { conflicts, applied: totals.applied, uploaded: totals.uploaded }
    }

    const items = []
    for (const o of outgoing) {
      const ct = o.value === null ? null : await encryptItem(key, config.epoch, o.id, o.value)
      if (ct && ct.length > LIMITS.itemChars) throw new SyncError('item-too-large', `${describeItem(o.id, o.value, local.items).label} is too large to sync.`)
      items.push({ id: o.id, base: o.base, ct })
    }
    const res = await api.push({ epoch: config.epoch, items })
    if (res.conflict) continue // someone else got there first: pull and reconcile again

    for (const o of outgoing) base[o.id] = { rev: res.rev, hash: o.hash }
    saveState(storage, { config, base, conflicts })
    totals.uploaded += outgoing.length
    verify = { rev: res.rev, items: Object.fromEntries(outgoing.map((o) => [o.id, o.hash])) }
  }
  throw new SyncError('busy', 'Other devices kept changing the same data. Try again in a moment.')
}

// ---- Preview for the first connection

const factsOf = (id, value) => {
  if (!value) return null
  const kind = kindOf(id)
  if (kind === 'run') return { ...summarizeAttempt(value), updated: +value.save.updated || +value.save.created || null, attempts: value.save.attempts }
  if (kind === 'archive') return { ...summarizeAttempt(value.data), updated: value.meta.archivedAt }
  if (kind === 'note') return { updatedAt: value.updatedAt }
  if (kind === 'attempt') return { checked: Object.keys(value.checklist).length, hasNotes: !!value.notes }
  return {}
}

export function describeConflict(c, local) {
  return {
    ...c,
    ...describeItem(c.id, local.items[c.id] || c.remote, { ...local.items }),
    choices: conflictChoices(c, local),
    here: c.id in local.items,
    there: !!c.remote,
    localFacts: factsOf(c.id, local.items[c.id]),
    remoteFacts: factsOf(c.id, c.remote),
    localLabel: local.items[c.id] ? describeItem(c.id, local.items[c.id], local.items).label : null,
    remoteLabel: c.remote ? describeItem(c.id, c.remote, local.items).label : null
  }
}

function buildPreview(plan, conflicts, local, localHashes, base) {
  const visible = (id) => id !== KEYCHECK_ID
  const settled = { ...base, ...Object.fromEntries(plan.ack.map((a) => [a.id, { rev: a.rev, hash: a.hash }])) }
  const upload = planOutgoing({ local, localHashes, base: settled, skip: new Set(conflicts.map((c) => c.id)) })
    .filter((o) => visible(o.id) && !plan.apply.some((a) => a.id === o.id))
    .map((o) => ({ id: o.id, ...describeItem(o.id, o.value, local.items), deleted: o.value === null }))
  const remoteItems = Object.fromEntries(plan.apply.filter((a) => a.value).map((a) => [a.id, a.value]))
  const download = plan.apply.filter((a) => visible(a.id)).map((a) => ({ id: a.id, ...describeItem(a.id, a.value, remoteItems), deleted: a.value === null }))
  return {
    upload,
    download,
    same: plan.ack.filter((a) => visible(a.id) && a.hash !== null).length,
    held: plan.hold.length,
    conflicts: conflicts.map((c) => describeConflict(c, local)),
    remoteInitialized: plan.ack.some((a) => a.id === KEYCHECK_ID) || plan.apply.some((a) => a.id === KEYCHECK_ID)
  }
}
