// localStorage keys and guarded read/write helpers for attempt history,
// knowledge and backups. Every function takes the Storage to use, so the
// modules stay pure and can be tested with an in-memory fake.

export const KEYS = {
  active: 'nuzlocke',
  saves: 'nuzlocke.saves',
  tracker: (id) => `nuzlocke.${id}`,
  side: (id) => `nuzlocke.${id}.unbound`, // see $lib/unbound/side
  attempt: (id) => `nuzlocke.${id}.attempt`,
  archiveIndex: 'nuzlocke.archive',
  archive: (id) => `nuzlocke.archive.${id}`,
  knowledge: 'nuzlocke.knowledge'
}

// Run and archive ids end up inside storage keys and the comma/pipe
// separated run list, so only uuid-like ids are accepted from files.
export const isValidId = (id) => typeof id === 'string' && /^[A-Za-z0-9-]{1,64}$/.test(id)

export const isPlainObject = (o) => !!o && typeof o === 'object' && !Array.isArray(o)

export class StorageError extends Error {
  constructor(message, cause) {
    super(message)
    this.name = 'StorageError'
    this.cause = cause
    this.quota = isQuotaError(cause)
  }
}

export const isQuotaError = (e) =>
  !!e && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED' || e.code === 22 || e.code === 1014)

/**
 * Reads and parses a JSON key.
 * @returns {{ exists: boolean, value: any, error: Error | null }}
 *   `error` is set when the key exists but can't be parsed, so callers can
 *   refuse to overwrite data they couldn't read.
 */
export function readJSON(storage, key) {
  let raw
  try {
    raw = storage.getItem(key)
  } catch (e) {
    return { exists: false, value: null, error: e }
  }
  if (raw === null || raw === undefined) return { exists: false, value: null, error: null }
  try {
    return { exists: true, value: JSON.parse(raw), error: null }
  } catch (e) {
    return { exists: true, value: null, error: e }
  }
}

export function stringify(value, what = 'data') {
  try {
    const raw = JSON.stringify(value)
    if (typeof raw !== 'string') throw new TypeError('Nothing to serialise')
    return raw
  } catch (e) {
    throw new StorageError(`Could not serialise ${what}`, e)
  }
}

/**
 * Applies `writes` ([{ key, raw }] where raw === null removes the key) as
 * close to atomically as localStorage allows: every set happens before any
 * removal, each set is read back and compared, and on any failure all keys
 * are restored to their previous values. Removals therefore only happen
 * once everything else has been written successfully.
 */
export function transact(storage, writes) {
  const sets = writes.filter((w) => w.raw !== null)
  const removes = writes.filter((w) => w.raw === null)
  const before = writes.map(({ key }) => [key, storage.getItem(key)])
  try {
    for (const { key, raw } of sets) {
      storage.setItem(key, raw)
      if (storage.getItem(key) !== raw) throw new StorageError(`Write to ${key} could not be verified`)
    }
    for (const { key } of removes) storage.removeItem(key)
  } catch (e) {
    for (const [key, prev] of before.reverse()) {
      try {
        prev === null ? storage.removeItem(key) : storage.setItem(key, prev)
      } catch (_) {
        // Best effort: removals never ran, so the original data still exists
      }
    }
    if (e instanceof StorageError) throw e
    throw new StorageError(isQuotaError(e) ? 'Browser storage is full' : 'Could not save to browser storage', e)
  }
}
