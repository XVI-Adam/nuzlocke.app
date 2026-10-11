// Per-attempt notes and checklist progress (`nuzlocke.<run>.attempt`), kept
// out of the tracker blob so encounter components never see it:
//
//   { version: 1,
//     notes: string,                                  // free-form attempt notes
//     checklist: { "<objective or prep item id>": { done: true, at } } }
//
// Checklist *definitions* live in the knowledge store and carry across
// attempts; only completion lives here, so a new attempt starts unticked.
import { KEYS, readJSON, stringify, transact, isPlainObject } from './storage.js'

export const ATTEMPT_VERSION = 1

export function normalizeAttempt(raw) {
  const a = isPlainObject(raw) ? raw : {}
  const checklist = {}
  for (const [id, v] of Object.entries(isPlainObject(a.checklist) ? a.checklist : {}))
    if (isPlainObject(v) && v.done === true) checklist[id] = { done: true, at: Number.isFinite(v.at) ? v.at : null }
  return { version: ATTEMPT_VERSION, notes: typeof a.notes === 'string' ? a.notes : '', checklist }
}

export const isEmptyAttempt = (a) => !a.notes && !Object.keys(a.checklist).length

export const setChecked = (attempt, itemId, done, now) => {
  const checklist = { ...attempt.checklist }
  if (done) checklist[itemId] = { done: true, at: now }
  else delete checklist[itemId]
  return { ...attempt, checklist }
}

/** @returns {{ attempt, error }} error is set when stored data is unreadable */
export function readAttempt(storage, runId) {
  const r = readJSON(storage, KEYS.attempt(runId))
  return { attempt: normalizeAttempt(r.value), error: r.error }
}

export function writeAttempt(storage, runId, attempt) {
  const a = normalizeAttempt(attempt)
  transact(storage, [{ key: KEYS.attempt(runId), raw: isEmptyAttempt(a) ? null : stringify(a, 'attempt notes') }])
}
