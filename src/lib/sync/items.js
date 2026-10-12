// Splits this device's data into sync items (see ./protocol.js) and writes
// items received from other devices back into browser storage. Pure module:
// every function takes the Storage to use.
//
// Covers exactly what a Phase 5 backup covers - runs, archived attempts and
// knowledge - and reuses its readers and normalisers. Theme, user id, the
// Unbound sync key and the sync settings themselves are never items.
import equal from 'fast-deep-equal'

import { KEYS, readJSON, stringify, transact, isPlainObject, isValidId } from '../history/storage.js'
import { parseSaves, formatSaves } from '../history/saves.js'
import { normalizeAttempt, isEmptyAttempt } from '../history/attempt.js'
import { readIndex, readRun, normalizeMeta, normalizeArchiveData, ARCHIVE_VERSION } from '../history/archive.js'
import { readKnowledge, normalizeEntry, SECTIONS } from '../history/knowledge.js'
import { saveMeta, toSavesEntry } from '../history/backup.js'
import { sanitizeImportedSide } from '../unbound/side.js'
import { ITEM_ID_RE, kindOf, refOf } from './protocol.js'

export const KEYCHECK_ID = 'meta:keycheck'
export const KEYCHECK = { check: 'nuzlocke-sync-v1' }

/** Archive meta fixed at archiving time, and the part the player may edit later */
export const ARCHIVE_FIXED = ['name', 'game', 'settings', 'attemptNumber', 'created', 'updated', 'archivedAt']
export const ARCHIVE_EDITABLE = ['title', 'status', 'summary']

const pick = (o, keys) => Object.fromEntries(keys.map((k) => [k, o[k]]))

/** Archive data without its storage format version */
const archiveData = (raw) => {
  const data = normalizeArchiveData(raw)
  delete data.version
  return data
}

export class SyncError extends Error {
  constructor(code, message, cause) {
    super(message || code)
    this.name = 'SyncError'
    this.code = code
    this.cause = cause
  }
}

/** JSON with sorted object keys, so equal data always serialises the same */
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map((v) => (v === undefined ? 'null' : canonical(v))).join(',')}]`
  if (value && typeof value === 'object')
    return `{${Object.keys(value)
      .filter((k) => value[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`)
      .join(',')}}`
  return JSON.stringify(value === undefined ? null : value)
}

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')

/**
 * What counts as a change. A run's "last played" time is bumped just by
 * opening the game page, so it is left out: otherwise two devices that only
 * opened the app would always conflict. It still travels with real changes.
 */
const syncedContent = (id, value) => {
  if (kindOf(id) !== 'run' || !isPlainObject(value?.save)) return value
  const save = { ...value.save }
  delete save.updated
  return { ...value, save }
}

/** SHA-256 of an item's canonical JSON (see syncedContent); null for a deleted item */
export async function hashItem(value, id = '') {
  if (value === null || value === undefined) return null
  return hex(await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical(syncedContent(id, value)))))
}

/**
 * Checks and normalises one item, with the same rules a backup restore uses.
 * Throws SyncError('invalid-item') when it can't be used.
 */
export function validateItem(id, value) {
  const bad = (why) => new SyncError('invalid-item', `${id}: ${why}`)
  if (typeof id !== 'string' || !ITEM_ID_RE.test(id)) throw bad('unknown item id')
  if (!isPlainObject(value)) throw bad('not an object')
  const kind = kindOf(id)
  const ref = refOf(id)

  if (kind === 'run') {
    const s = value.save
    if (!isPlainObject(s) || s.id !== ref) throw bad('run id mismatch')
    if (typeof s.game !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(s.game)) throw bad('invalid game')
    if (!Number.isFinite(+s.created) || s.created === null || s.created === '') throw bad('missing created time')
    if (!isPlainObject(value.tracker)) throw bad('invalid tracker')
    const side = value.unbound ? sanitizeImportedSide(value.unbound, value.tracker) : null
    return { save: saveMeta(s), tracker: value.tracker, unbound: side ? side.side : null }
  }
  if (kind === 'attempt') return normalizeAttempt(value)
  if (kind === 'archive') {
    if (!isPlainObject(value.meta) || !isPlainObject(value.data) || !isPlainObject(value.data.tracker)) throw bad('invalid archive')
    return { meta: pick(normalizeMeta(value.meta, ref), ARCHIVE_FIXED), data: archiveData(value.data) }
  }
  if (kind === 'archmeta') return pick(normalizeMeta(value, ref), ARCHIVE_EDITABLE)
  if (kind === 'note') {
    const section = id.split(':')[1]
    if (value.id !== ref) throw bad('entry id mismatch')
    return normalizeEntry(section, value)
  }
  if (value.check !== KEYCHECK.check) throw bad('unexpected key check')
  return { ...KEYCHECK }
}

/** true when `id` is listed in `blocked`, directly or by a `kind:` prefix */
export const isBlocked = (blocked, id) => blocked.some((b) => (b.endsWith(':') ? id.startsWith(b) : b === id))

/**
 * This device's data as items. Anything that can't be read is listed in
 * `blocked` instead: it is neither uploaded nor treated as deleted, and
 * nothing received for it is written over it.
 * @returns {{ items: { [id]: value }, blocked: string[], problems: string[] }}
 */
export function readLocal(storage) {
  const items = { [KEYCHECK_ID]: { ...KEYCHECK } }
  const blocked = []
  const problems = []
  const add = (id, value) => {
    try {
      items[id] = validateItem(id, value)
    } catch (e) {
      blocked.push(id)
      problems.push(e.message)
    }
  }

  for (const save of Object.values(parseSaves(storage.getItem(KEYS.saves)))) {
    if (!isValidId(save.id)) {
      problems.push(`Run “${save.name}” has an id that can’t be synced.`)
      continue
    }
    try {
      const d = readRun(storage, save.id)
      add(`run:${save.id}`, { save, tracker: d.tracker, unbound: d.unbound })
      if (!isEmptyAttempt(d.attempt)) add(`attempt:${save.id}`, d.attempt)
    } catch (e) {
      blocked.push(`run:${save.id}`, `attempt:${save.id}`)
      problems.push(e.message)
    }
  }

  let index = null
  try {
    index = readIndex(storage)
  } catch (e) {
    blocked.push('archive:', 'archmeta:')
    problems.push(e.message)
  }
  for (const meta of Object.values(index?.attempts || {})) {
    const r = readJSON(storage, KEYS.archive(meta.id))
    if (!r.exists || r.error || !isPlainObject(r.value)) {
      blocked.push(`archive:${meta.id}`, `archmeta:${meta.id}`)
      problems.push(`Archived attempt “${meta.title || meta.name}” could not be read.`)
      continue
    }
    add(`archive:${meta.id}`, { meta, data: r.value })
    add(`archmeta:${meta.id}`, meta)
  }

  const k = readKnowledge(storage)
  if (k.error) {
    blocked.push('note:')
    problems.push('Stored notes could not be read.')
  } else for (const section of SECTIONS) for (const e of k.knowledge[section]) add(`note:${section}:${e.id}`, e)

  return { items, blocked, problems }
}

/** Picks the run to make active when the active one went away */
function fallbackActive(saves, previous) {
  const runs = Object.values(saves).sort((a, b) => +b.created - +a.created)
  return (previous && runs.find((r) => r.name === previous.name && r.game === previous.game)) || runs[0] || null
}

const ORDER = { archive: 0, archmeta: 1, run: 2, attempt: 3, note: 4, meta: 5 }

/**
 * Writes validated items into storage in one verified transaction (see
 * history/storage transact): `changes` is [{ id, value | null }], null
 * meaning deleted.
 *
 * Safety rules, enforced here whatever the caller planned:
 * - an archived attempt's data is never changed: receiving different data
 *   for an archive this device already has throws, unless the player chose
 *   that explicitly (`replaceArchives` holds its id, after keeping a copy)
 * - run and attempt data is never written for an archived attempt
 * - an active run is only removed by an archive or deletion received for it
 *
 * @returns {{ applied: string[], skipped: [{ id, reason }], active }}
 */
export function applyChanges(storage, changes, { replaceArchives = [] } = {}) {
  const saves = parseSaves(storage.getItem(KEYS.saves))
  const index = readIndex(storage) // throws when unreadable: nothing is written
  const k = readKnowledge(storage)
  if (k.error && changes.some((c) => c.id.startsWith('note:'))) throw new SyncError('notes-unreadable', 'Stored notes could not be read, so they were not changed.')
  const knowledge = k.knowledge
  const writes = []
  const applied = []
  const skipped = []
  let savesChanged = false,
    indexChanged = false,
    knowledgeChanged = false

  const prevActiveId = storage.getItem(KEYS.active)
  const prevActive = saves[prevActiveId] || null
  const removeRunKeys = (id) => writes.push({ key: KEYS.tracker(id), raw: null }, { key: KEYS.side(id), raw: null })

  const sorted = [...changes].sort((a, b) => ORDER[kindOf(a.id)] - ORDER[kindOf(b.id)])
  for (const { id, value } of sorted) {
    const kind = kindOf(id)
    const ref = refOf(id)

    if (kind === 'archive') {
      if (value) {
        const existing = index.attempts[ref] ? readJSON(storage, KEYS.archive(ref)) : null
        if (existing?.exists && !existing.error) {
          const current = archiveData(existing.value)
          if (!equal(current, value.data) && !replaceArchives.includes(ref))
            throw new SyncError('archive-immutable', 'A received archived attempt differs from this device’s copy, so nothing was changed.')
          if (!equal(current, value.data)) writes.push({ key: KEYS.archive(ref), raw: stringify({ version: ARCHIVE_VERSION, ...value.data }, 'an archived attempt') })
        } else writes.push({ key: KEYS.archive(ref), raw: stringify({ version: ARCHIVE_VERSION, ...value.data }, 'an archived attempt') })
        const editable = index.attempts[ref] ? pick(index.attempts[ref], ARCHIVE_EDITABLE) : { title: value.meta.name }
        index.attempts[ref] = normalizeMeta({ ...value.meta, ...editable }, ref)
        indexChanged = true
        if (saves[ref]) {
          // Archived on another device: the active copy here retires
          delete saves[ref]
          savesChanged = true
          removeRunKeys(ref)
          writes.push({ key: KEYS.attempt(ref), raw: null })
        }
      } else if (index.attempts[ref]) {
        delete index.attempts[ref]
        indexChanged = true
        writes.push({ key: KEYS.archive(ref), raw: null })
      }
    } else if (kind === 'archmeta') {
      if (!value) {
        applied.push(id) // goes with the archive's own deletion
        continue
      }
      if (!index.attempts[ref]) {
        skipped.push({ id, reason: 'archive-missing' })
        continue
      }
      index.attempts[ref] = normalizeMeta({ ...index.attempts[ref], ...value }, ref)
      indexChanged = true
    } else if (kind === 'run') {
      if (index.attempts[ref]) {
        if (value) skipped.push({ id, reason: 'archived' })
        else applied.push(id)
        continue
      }
      if (value) {
        saves[ref] = toSavesEntry(value.save)
        writes.push({ key: KEYS.tracker(ref), raw: stringify(value.tracker, 'a run') }, { key: KEYS.side(ref), raw: value.unbound ? stringify(value.unbound, 'Unbound data') : null })
      } else if (saves[ref]) {
        delete saves[ref]
        removeRunKeys(ref)
      }
      savesChanged = true
    } else if (kind === 'attempt') {
      if (index.attempts[ref]) {
        skipped.push({ id, reason: 'archived' })
        continue
      }
      const a = value ? normalizeAttempt(value) : null
      writes.push({ key: KEYS.attempt(ref), raw: a && !isEmptyAttempt(a) ? stringify(a, 'attempt notes') : null })
    } else if (kind === 'note') {
      const section = id.split(':')[1]
      const list = knowledge[section]
      knowledge[section] = value
        ? list.some((e) => e.id === ref)
          ? list.map((e) => (e.id === ref ? value : e))
          : list.concat(value)
        : list.filter((e) => e.id !== ref)
      knowledgeChanged = true
    }
    applied.push(id)
  }

  // Keep the active run; if it went away (or this device had none yet),
  // continue with the latest attempt of the same run
  let active = prevActiveId
  if (!active || !saves[active]) active = fallbackActive(saves, prevActive)?.id || null

  if (savesChanged || active !== prevActiveId) writes.push({ key: KEYS.saves, raw: formatSaves(saves) }, { key: KEYS.active, raw: active })
  if (indexChanged) writes.push({ key: KEYS.archiveIndex, raw: stringify(index, 'the history index') })
  if (knowledgeChanged) writes.push({ key: KEYS.knowledge, raw: stringify(knowledge, 'notes') })

  transact(storage, writes)
  return { applied, skipped, active }
}

/**
 * A run or archived attempt saved under a new id, for "keep both" conflict
 * choices. Ids inside the data (tracker record keys, links) don't depend on
 * the run id, so the data is copied unchanged.
 * @returns [{ id, value }] the items to create
 */
export function copyItems(id, value, extra, newId, label) {
  const kind = kindOf(id)
  if (kind === 'run') {
    const out = [{ id: `run:${newId}`, value: { ...value, save: { ...value.save, id: newId, name: `${value.save.name} (${label})`.slice(0, 200) } } }]
    if (extra) out.push({ id: `attempt:${newId}`, value: extra })
    return out
  }
  if (kind === 'archive') {
    const meta = extra || { title: value.meta.name, status: 'archived', summary: '' }
    return [
      { id: `archive:${newId}`, value },
      { id: `archmeta:${newId}`, value: { ...meta, title: `${meta.title || value.meta.name} (${label})`.slice(0, 200) } }
    ]
  }
  throw new SyncError('cannot-copy', `${kind} items can’t be copied`)
}

/** A short human label for an item, for previews and conflicts */
export function describeItem(id, value, items = {}) {
  const kind = kindOf(id)
  const ref = refOf(id)
  if (!value) return { kind, label: '(deleted)' }
  if (kind === 'run') return { kind, label: value.save.name || 'Untitled run' }
  if (kind === 'attempt') return { kind, label: items[`run:${ref}`]?.save?.name || 'a run' }
  if (kind === 'archive') return { kind, label: items[`archmeta:${ref}`]?.title || value.meta.name || 'Archived attempt' }
  if (kind === 'archmeta') return { kind, label: value.title || items[`archive:${ref}`]?.meta?.name || 'Archived attempt' }
  if (kind === 'note') return { kind, section: id.split(':')[1], label: (value.name || value.text || '').slice(0, 80) || '(untitled)' }
  return { kind, label: 'Encryption check' }
}
