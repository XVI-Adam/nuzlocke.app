// Attempt history. An attempt is a run id (uuid). Archiving copies the run's
// tracker blob, Unbound side key and attempt notes into a frozen blob under
// its own key, then starts a new run with a new id, so nothing that writes to
// the active run (tracker components, save sync) can reach an archive.
//
//   nuzlocke.archive          { version: 1, attempts: { [id]: meta } }
//   nuzlocke.archive.<id>     { version: 1, tracker, unbound, attempt }
//
// Only meta.title / status / summary are editable afterwards.
import { KEYS, readJSON, stringify, transact, isPlainObject, isValidId, StorageError } from './storage.js'
import { parseSaves, formatSaves } from './saves.js'
import { normalizeAttempt } from './attempt.js'
import { normalizeSide } from '../unbound/side.js'

export const ARCHIVE_VERSION = 1
export const STATUSES = ['archived', 'abandoned', 'lost', 'completed']
export const STATUS_LABELS = { archived: 'Archived', abandoned: 'Abandoned', lost: 'Lost', completed: 'Completed' }

// Same groups as $lib/data/states (not importable here: it pulls in icons)
const AVAILABLE = [1, 2, 3, 6]
const DEAD = [5]

export class HistoryError extends Error {
  constructor(code, message, cause) {
    super(message)
    this.name = 'HistoryError'
    this.code = code
    this.cause = cause
  }
}

const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(+v) ? null : +v)
const str = (v, max = 4000) => (typeof v === 'string' ? v.slice(0, max) : '')

export function normalizeMeta(raw, id) {
  const m = isPlainObject(raw) ? raw : {}
  return {
    id,
    title: str(m.title, 200),
    name: str(m.name, 200),
    game: str(m.game, 64),
    settings: typeof m.settings === 'string' ? m.settings : '',
    attemptNumber: Number.isInteger(m.attemptNumber) && m.attemptNumber > 0 ? m.attemptNumber : null,
    created: num(m.created),
    updated: num(m.updated),
    archivedAt: num(m.archivedAt),
    status: STATUSES.includes(m.status) ? m.status : 'archived',
    summary: str(m.summary)
  }
}

export function normalizeIndex(raw) {
  const attempts = {}
  const src = isPlainObject(raw) && isPlainObject(raw.attempts) ? raw.attempts : {}
  for (const [id, m] of Object.entries(src)) if (isValidId(id) && isPlainObject(m)) attempts[id] = normalizeMeta(m, id)
  return { version: ARCHIVE_VERSION, attempts }
}

export function normalizeArchiveData(raw) {
  const d = isPlainObject(raw) ? raw : {}
  return {
    version: ARCHIVE_VERSION,
    tracker: isPlainObject(d.tracker) ? d.tracker : {},
    unbound: isPlainObject(d.unbound) ? d.unbound : null,
    attempt: normalizeAttempt(d.attempt)
  }
}

/** The archive index; throws when it exists but can't be read, so it's never overwritten */
export function readIndex(storage) {
  const r = readJSON(storage, KEYS.archiveIndex)
  if (r.error) throw new HistoryError('index-unreadable', 'Your attempt history index could not be read, so nothing was changed.', r.error)
  return normalizeIndex(r.value)
}

/**
 * Facts about an attempt, only from what was recorded. Values that were never
 * stored are null (shown as unknown), never estimated.
 */
export function summarizeAttempt({ tracker, unbound } = {}) {
  const t = isPlainObject(tracker) ? tracker : {}
  const records = Object.entries(t).filter(([k, r]) => !k.startsWith('__') && isPlainObject(r) && r.pokemon)
  const baseline = isPlainObject(unbound) ? normalizeSide(unbound).baseline : null
  const progress = baseline?.snapshot?.progress
  return {
    encounters: records.length,
    available: records.filter(([, r]) => AVAILABLE.includes(r.status)).length,
    deaths: records.filter(([, r]) => DEAD.includes(r.status)).length,
    team: (Array.isArray(t.__team) ? t.__team : []).map((k) => t[k]?.pokemon).filter(Boolean),
    bossFights: Array.isArray(t.__teams) ? t.__teams.length : 0,
    badges: Number.isInteger(progress?.badges) ? progress.badges : null,
    champion: typeof progress?.champion === 'boolean' ? progress.champion : null,
    lastSave: baseline ? { saveIndex: baseline.snapshot.game.saveIndex, acceptedAt: baseline.acceptedAt } : null
  }
}

/** Reads a run's own keys; throws instead of returning partial data */
export function readRun(storage, runId) {
  const tracker = readJSON(storage, KEYS.tracker(runId))
  const side = readJSON(storage, KEYS.side(runId))
  const attempt = readJSON(storage, KEYS.attempt(runId))
  if (tracker.error || (tracker.exists && !isPlainObject(tracker.value)))
    throw new HistoryError('tracker-unreadable', 'This attempt’s tracker data could not be read, so it was not changed.', tracker.error)
  if (side.error || (side.exists && !isPlainObject(side.value)))
    throw new HistoryError('side-unreadable', 'This attempt’s Unbound save data could not be read, so it was not changed.', side.error)
  if (attempt.error) throw new HistoryError('attempt-unreadable', 'This attempt’s notes could not be read, so it was not changed.', attempt.error)
  return {
    tracker: tracker.value || {},
    unbound: side.exists ? side.value : null,
    attempt: normalizeAttempt(attempt.value)
  }
}

const newRunFrom = (run, newRunId, now) => ({
  id: newRunId,
  created: now,
  name: run.name,
  game: run.game,
  settings: run.settings,
  attempts: (+run.attempts || 1) + 1
})

function startNewWrites(storage, saves, run, newRunId, now) {
  if (!isValidId(newRunId) || saves[newRunId]) throw new HistoryError('bad-new-id', 'Could not create a new attempt id.')
  const next = { ...saves }
  delete next[run.id]
  next[newRunId] = newRunFrom(run, newRunId, now)
  return [
    { key: KEYS.tracker(newRunId), raw: '{}' },
    { key: KEYS.saves, raw: formatSaves(next) },
    { key: KEYS.active, raw: newRunId },
    { key: KEYS.tracker(run.id), raw: null },
    { key: KEYS.side(run.id), raw: null },
    { key: KEYS.attempt(run.id), raw: null }
  ]
}

function findRun(storage, runId) {
  const saves = parseSaves(storage.getItem(KEYS.saves))
  const run = saves[runId]
  if (!isValidId(runId) || !run) throw new HistoryError('run-not-found', 'That run no longer exists.')
  return { saves, run }
}

/**
 * Archives `runId` and starts a new attempt `newRunId`. Either everything is
 * written or nothing changes (see transact); the old run's keys are removed
 * only after the archive has been written and verified.
 * @returns {{ archiveId, newRunId }}
 */
export function archiveAndStartNew(storage, { runId, newRunId, title = '', status = 'archived', summary = '', now }) {
  const { saves, run } = findRun(storage, runId)
  const data = readRun(storage, runId)
  const index = readIndex(storage)
  if (index.attempts[runId] || storage.getItem(KEYS.archive(runId)) !== null)
    throw new HistoryError('archive-exists', 'An archived attempt with this id already exists, so nothing was changed.')

  const meta = normalizeMeta(
    {
      title: title.trim() || run.name,
      name: run.name,
      game: run.game,
      settings: run.settings,
      attemptNumber: +run.attempts || 1,
      created: run.created,
      updated: run.updated,
      archivedAt: now,
      status,
      summary: summary.trim()
    },
    runId
  )
  const blob = { version: ARCHIVE_VERSION, ...data }
  const nextIndex = { ...index, attempts: { ...index.attempts, [runId]: meta } }

  try {
    transact(storage, [
      { key: KEYS.archive(runId), raw: stringify(blob, 'the attempt') },
      { key: KEYS.archiveIndex, raw: stringify(nextIndex, 'the history index') },
      ...startNewWrites(storage, saves, run, newRunId, now)
    ])
  } catch (e) {
    if (e instanceof StorageError)
      throw new HistoryError(e.quota ? 'quota' : 'write-failed', `${e.message}. Your attempt was not changed.`, e)
    throw e
  }
  return { archiveId: runId, newRunId }
}

/** Starts a new attempt without keeping the old one. Callers must confirm first. */
export function discardAndStartNew(storage, { runId, newRunId, now }) {
  const { saves, run } = findRun(storage, runId)
  try {
    transact(storage, startNewWrites(storage, saves, run, newRunId, now))
  } catch (e) {
    if (e instanceof StorageError) throw new HistoryError('write-failed', `${e.message}. Your attempt was not changed.`, e)
    throw e
  }
  return { newRunId }
}

/**
 * True only for the current active run that is still in the run list and not
 * archived. Save sync checks this right before writing, so a stale page
 * (e.g. another tab archived the run) can never write to an old attempt.
 */
export function isWritableRun(storage, runId) {
  if (!isValidId(runId) || storage.getItem(KEYS.active) !== runId) return false
  if (!parseSaves(storage.getItem(KEYS.saves))[runId]) return false
  const r = readJSON(storage, KEYS.archiveIndex)
  return !r.error && !normalizeIndex(r.value).attempts[runId] && storage.getItem(KEYS.archive(runId)) === null
}

/** All archived attempts, newest first, each with its recorded summary */
export function listArchives(storage) {
  const index = readIndex(storage)
  return Object.values(index.attempts)
    .map((meta) => {
      const r = readJSON(storage, KEYS.archive(meta.id))
      const ok = r.exists && !r.error && isPlainObject(r.value)
      return { meta, missing: !ok, stats: ok ? summarizeAttempt(normalizeArchiveData(r.value)) : null }
    })
    .sort((a, b) => (b.meta.archivedAt || 0) - (a.meta.archivedAt || 0))
}

/** Archived attempts that recorded a fight against boss `ref` (a routes.json boss id) */
export function recordedFights(storage, ref) {
  if (!ref) return []
  return Object.values(readIndex(storage).attempts).flatMap((meta) => {
    const r = readJSON(storage, KEYS.archive(meta.id))
    const fight = isPlainObject(r.value) && Array.isArray(r.value.tracker?.__teams) && r.value.tracker.__teams.find((t) => t?.id === ref)
    return fight ? [{ id: meta.id, title: meta.title || meta.name, team: (fight.team || []).map((m) => m?.sprite).filter(Boolean) }] : []
  })
}

/** @returns {{ meta, data } | null} */
export function readArchive(storage, id) {
  const index = readIndex(storage)
  const meta = index.attempts[id]
  if (!meta) return null
  const r = readJSON(storage, KEYS.archive(id))
  if (!r.exists || r.error || !isPlainObject(r.value)) return { meta, data: null }
  return { meta, data: normalizeArchiveData(r.value) }
}

/** Edits title, status or summary; the archived data itself is never rewritten */
export function updateArchiveMeta(storage, id, patch) {
  const index = readIndex(storage)
  const meta = index.attempts[id]
  if (!meta) throw new HistoryError('archive-not-found', 'That archived attempt no longer exists.')
  const allowed = {}
  for (const k of ['title', 'status', 'summary']) if (k in patch) allowed[k] = patch[k]
  const next = normalizeMeta({ ...meta, ...allowed }, id)
  transact(storage, [{ key: KEYS.archiveIndex, raw: stringify({ ...index, attempts: { ...index.attempts, [id]: next } }) }])
  return next
}

/** Permanently deletes one archived attempt. Callers must confirm first. */
export function deleteArchive(storage, id) {
  const index = readIndex(storage)
  if (!index.attempts[id]) throw new HistoryError('archive-not-found', 'That archived attempt no longer exists.')
  const attempts = { ...index.attempts }
  delete attempts[id]
  transact(storage, [
    { key: KEYS.archiveIndex, raw: stringify({ ...index, attempts }) },
    { key: KEYS.archive(id), raw: null }
  ])
}
