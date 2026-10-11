// Full-device backup and restore/merge, for moving between computer and
// phone. A backup holds every run (tracker, Unbound side data, attempt
// notes), every archived attempt and the knowledge store - and nothing else
// (no sync key, theme or user id).
//
// Restoring never silently overwrites: each run, archive and knowledge entry
// is classified as new / same / conflict, and the player picks keep (this
// device) or replace (backup) for each. Ids are preserved as-is.
import equal from 'fast-deep-equal'

import { KEYS, stringify, transact, isPlainObject, isValidId } from './storage.js'
import { parseSaves, formatSaves } from './saves.js'
import { normalizeAttempt, isEmptyAttempt } from './attempt.js'
import { readIndex, readRun, readArchive, normalizeMeta, normalizeArchiveData, summarizeAttempt } from './archive.js'
import { normalizeKnowledge, readKnowledge, SECTIONS } from './knowledge.js'
import { sanitizeImportedSide, normalizeSide } from '../unbound/side.js'

export const BACKUP_FORMAT = 'nuzlocke-backup'
export const BACKUP_VERSION = 1

export class BackupError extends Error {
  constructor(message, cause) {
    super(message)
    this.name = 'BackupError'
    this.cause = cause
  }
}

const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(+v) ? null : +v)

/** A run-list entry as plain JSON (timestamps as numbers) */
const saveMeta = (s) => ({
  id: s.id,
  name: typeof s.name === 'string' ? s.name.slice(0, 200) : '',
  game: s.game,
  settings: typeof s.settings === 'string' ? s.settings : '',
  attempts: Number.isInteger(+s.attempts) && +s.attempts > 0 ? +s.attempts : 1,
  created: num(s.created),
  updated: num(s.updated)
})

const toSavesEntry = (m) => ({
  id: m.id,
  created: m.created,
  ...(m.updated ? { updated: m.updated } : {}),
  name: m.name,
  game: m.game,
  settings: m.settings,
  attempts: m.attempts
})

/**
 * @returns {{ backup, skipped: [{ kind, id, label, reason }] }} parts that
 *   couldn't be read are reported in `skipped`, never silently dropped.
 */
export function buildBackup(storage, now) {
  const skipped = []
  const runs = []
  for (const save of Object.values(parseSaves(storage.getItem(KEYS.saves)))) {
    if (!isValidId(save.id)) {
      skipped.push({ kind: 'run', id: save.id, label: save.name, reason: 'Unsupported run id' })
      continue
    }
    try {
      const d = readRun(storage, save.id)
      runs.push({ save: saveMeta(save), tracker: d.tracker, unbound: d.unbound, attempt: d.attempt })
    } catch (e) {
      skipped.push({ kind: 'run', id: save.id, label: save.name, reason: e.message })
    }
  }

  const archives = []
  try {
    for (const meta of Object.values(readIndex(storage).attempts)) {
      const a = readArchive(storage, meta.id)
      if (a?.data) archives.push({ meta: a.meta, data: a.data })
      else skipped.push({ kind: 'archive', id: meta.id, label: meta.title, reason: 'Archived data is missing or unreadable' })
    }
  } catch (e) {
    skipped.push({ kind: 'archive', id: null, label: 'Attempt history', reason: e.message })
  }

  const { knowledge, error } = readKnowledge(storage)
  if (error) skipped.push({ kind: 'knowledge', id: null, label: 'Notes', reason: 'Stored notes could not be read' })

  const active = storage.getItem(KEYS.active)
  return {
    backup: {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      exportedAt: now,
      active: isValidId(active) ? active : null,
      runs,
      archives,
      knowledge
    },
    skipped
  }
}

/**
 * Checks a parsed backup file and returns a cleaned copy. Throws BackupError
 * when the file isn't a usable backup; individual bad items are dropped
 * with a warning.
 */
export function validateBackup(parsed) {
  if (!isPlainObject(parsed) || parsed.format !== BACKUP_FORMAT) throw new BackupError('This is not a Nuzlocke backup file.')
  if (!Number.isInteger(parsed.version) || parsed.version < 1) throw new BackupError('This backup has no valid version.')
  if (parsed.version > BACKUP_VERSION) throw new BackupError('This backup was made by a newer version of the app.')

  const warnings = []
  const archives = []
  const archiveIds = new Set()
  for (const a of Array.isArray(parsed.archives) ? parsed.archives : []) {
    const id = a?.meta?.id
    if (!isValidId(id) || archiveIds.has(id) || !isPlainObject(a?.data) || !isPlainObject(a.data.tracker)) {
      warnings.push(`Skipped an invalid archived attempt${typeof id === 'string' ? ` (${id})` : ''}.`)
      continue
    }
    archiveIds.add(id)
    archives.push({ meta: normalizeMeta(a.meta, id), data: normalizeArchiveData(a.data) })
  }

  const runs = []
  const runIds = new Set()
  for (const r of Array.isArray(parsed.runs) ? parsed.runs : []) {
    const s = r?.save
    const id = s?.id
    if (!isValidId(id) || runIds.has(id) || typeof s.game !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(s.game) || !isPlainObject(r.tracker) || num(s.created) === null) {
      warnings.push(`Skipped an invalid run${typeof s?.name === 'string' ? ` (${s.name})` : ''}.`)
      continue
    }
    if (archiveIds.has(id)) {
      warnings.push(`Skipped run “${s.name}”: the backup also has it archived.`)
      continue
    }
    runIds.add(id)
    const imported = r.unbound ? sanitizeImportedSide(r.unbound, r.tracker) : null
    if (imported?.rejected.length) warnings.push(`Ignored ${imported.rejected.length} invalid Unbound link(s) in “${s.name}”.`)
    runs.push({ save: saveMeta(s), tracker: r.tracker, unbound: imported ? imported.side : null, attempt: normalizeAttempt(r.attempt) })
  }

  return {
    backup: {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      exportedAt: num(parsed.exportedAt),
      active: isValidId(parsed.active) ? parsed.active : null,
      runs,
      archives,
      knowledge: normalizeKnowledge(parsed.knowledge)
    },
    warnings
  }
}

const sameRun = (a, b) =>
  equal({ ...a.save, updated: null }, { ...b.save, updated: null }) &&
  equal(a.tracker, b.tracker) &&
  equal(a.unbound ? normalizeSide(a.unbound) : null, b.unbound ? normalizeSide(b.unbound) : null) &&
  equal(normalizeAttempt(a.attempt), normalizeAttempt(b.attempt))

const runFacts = (r) => ({ ...summarizeAttempt(r), updated: r.save.updated || r.save.created, attempts: r.save.attempts })
const entryLabel = (section, e) => (section === 'lessons' ? e.text.slice(0, 80) : e.name) || '(untitled)'

/**
 * Compares a validated backup with this device.
 * Each item: { key, type, section?, id, label, state, choices, default, note?, local?, incoming? }
 *   state: 'new' (choices add/skip) | 'same' | 'conflict' (keep/replace)
 */
export function planRestore(storage, backup) {
  const saves = parseSaves(storage.getItem(KEYS.saves))
  const index = readIndex(storage) // throws if unreadable: nothing is applied
  const { knowledge, error } = readKnowledge(storage)
  if (error) throw new BackupError('Notes on this device could not be read, so the backup was not applied.')

  const items = []
  const add = (item) => items.push({ ...item, default: item.state === 'conflict' ? 'keep' : item.state === 'new' ? 'add' : null })

  for (const run of backup.runs) {
    const { id } = run.save
    const base = { key: `run:${id}`, type: 'run', id, label: run.save.name, incoming: runFacts(run) }
    if (index.attempts[id]) {
      add({ ...base, state: 'conflict', choices: ['keep'], note: 'Archived on this device; the backup’s active copy will not be restored.' })
    } else if (saves[id]) {
      let local
      try {
        local = { save: saveMeta(saves[id]), ...readRun(storage, id) }
      } catch (e) {
        add({ ...base, state: 'conflict', choices: ['keep', 'replace'], note: e.message })
        continue
      }
      if (sameRun(local, run)) add({ ...base, state: 'same' })
      else add({ ...base, state: 'conflict', choices: ['keep', 'replace'], local: runFacts(local) })
    } else add({ ...base, state: 'new', choices: ['add', 'skip'] })
  }

  for (const a of backup.archives) {
    const { id } = a.meta
    const base = { key: `archive:${id}`, type: 'archive', id, label: a.meta.title || a.meta.name, incoming: summarizeAttempt(a.data) }
    if (index.attempts[id]) {
      const local = readArchive(storage, id)
      if (local?.data && equal(local.meta, a.meta) && equal(local.data, a.data)) add({ ...base, state: 'same' })
      else
        add({
          ...base,
          state: 'conflict',
          choices: ['keep', 'replace'],
          local: local?.data ? summarizeAttempt(local.data) : null,
          note: local?.data && equal(local.data, a.data) ? 'Only the title, status or summary differ.' : null
        })
    } else if (saves[id]) {
      add({
        ...base,
        state: 'conflict',
        choices: ['keep', 'replace'],
        note: 'Still active on this device. Replacing archives it here and removes the active copy from this device.'
      })
    } else add({ ...base, state: 'new', choices: ['add', 'skip'] })
  }

  for (const section of SECTIONS) {
    const localById = Object.fromEntries(knowledge[section].map((e) => [e.id, e]))
    for (const e of backup.knowledge[section]) {
      const local = localById[e.id]
      const base = { key: `${section}:${e.id}`, type: 'knowledge', section, id: e.id, label: entryLabel(section, e) }
      if (!local) add({ ...base, state: 'new', choices: ['add', 'skip'] })
      else if (equal(local, e)) add({ ...base, state: 'same' })
      else add({ ...base, state: 'conflict', choices: ['keep', 'replace'], local: { updatedAt: local.updatedAt }, incoming: { updatedAt: e.updatedAt } })
    }
  }

  return { items, active: backup.active }
}

/**
 * Applies a validated backup with the player's decisions ({ [item.key]:
 * 'keep' | 'replace' | 'add' | 'skip' }; missing = the item's default).
 * Re-plans against current storage first and writes everything in one
 * transaction.
 */
export function applyRestore(storage, backup, decisions = {}, { switchActive = false } = {}) {
  const { items } = planRestore(storage, backup)
  const choose = (item) => {
    const d = decisions[item.key]
    return item.choices?.includes(d) ? d : item.default
  }
  const taken = (item) => ['add', 'replace'].includes(choose(item))

  const saves = parseSaves(storage.getItem(KEYS.saves))
  const index = readIndex(storage)
  const knowledge = readKnowledge(storage).knowledge
  const writes = []
  const counts = { runs: 0, archives: 0, knowledge: 0 }
  let localActive = storage.getItem(KEYS.active)

  const runWrites = (id, tracker, unbound, attempt) => [
    { key: KEYS.tracker(id), raw: stringify(tracker, 'a run') },
    { key: KEYS.side(id), raw: unbound ? stringify(unbound, 'Unbound data') : null },
    { key: KEYS.attempt(id), raw: attempt && !isEmptyAttempt(attempt) ? stringify(attempt, 'attempt notes') : null }
  ]

  for (const item of items.filter(taken)) {
    if (item.type === 'run') {
      const run = backup.runs.find((r) => r.save.id === item.id)
      saves[item.id] = toSavesEntry(run.save)
      writes.push(...runWrites(item.id, run.tracker, run.unbound, run.attempt))
      counts.runs++
    } else if (item.type === 'archive') {
      const a = backup.archives.find((x) => x.meta.id === item.id)
      index.attempts[item.id] = a.meta
      writes.push({ key: KEYS.archive(item.id), raw: stringify({ version: 1, ...a.data }, 'an archived attempt') })
      if (saves[item.id]) {
        // Archived on the other device: retire the local active copy
        delete saves[item.id]
        writes.push(...runWrites(item.id, {}, null, null).map((w) => ({ ...w, raw: null })))
        if (localActive === item.id) localActive = null
      }
      counts.archives++
    } else {
      const e = backup.knowledge[item.section].find((x) => x.id === item.id)
      const list = knowledge[item.section]
      knowledge[item.section] = list.some((x) => x.id === e.id) ? list.map((x) => (x.id === e.id ? e : x)) : list.concat(e)
      counts.knowledge++
    }
  }

  let active = localActive
  if (switchActive && backup.active && saves[backup.active]) active = backup.active
  if (active && !saves[active]) active = null

  if (counts.runs || counts.archives || active !== storage.getItem(KEYS.active))
    writes.push({ key: KEYS.saves, raw: formatSaves(saves) }, { key: KEYS.active, raw: active })
  if (counts.archives) writes.push({ key: KEYS.archiveIndex, raw: stringify(index, 'the history index') })
  if (counts.knowledge) writes.push({ key: KEYS.knowledge, raw: stringify(knowledge, 'notes') })

  // Sets before removes, verified, rolled back on failure (see transact)
  transact(storage, writes)
  return { ...counts, active }
}

/** Reads a backup file's text */
export function parseBackupText(text) {
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch (e) {
    throw new BackupError('This file is not valid JSON.', e)
  }
  return validateBackup(parsed)
}
