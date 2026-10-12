// This device's sync settings and bookkeeping, kept in browser storage under
// `nuzlocke.sync*`. None of it is ever an item, part of a backup, or sent to
// the server except the device token (as a bearer credential).
//
//   nuzlocke.sync            { version, deviceId, deviceName, token, key, epoch,
//                              cursor, connected, lastSyncedAt }
//   nuzlocke.sync.base       { [itemId]: { rev, hash } }  last synced state per item
//   nuzlocke.sync.conflicts  [{ id, rev, remote, hash, reason, at }]
//
// `key` is the dataset's encryption key (base64url). `connected` only turns
// true after the first sync was confirmed and verified.
import { readJSON, stringify, transact, isPlainObject } from '../history/storage.js'

export const SYNC_KEYS = {
  config: 'nuzlocke.sync',
  base: 'nuzlocke.sync.base',
  conflicts: 'nuzlocke.sync.conflicts'
}

// Device-only keys that share the `nuzlocke.<x>` shape of a run's tracker key
const DEVICE_KEYS = new Set(['nuzlocke.user', 'nuzlocke.theme', 'nuzlocke.consent', 'nuzlocke.support', 'nuzlocke.sync'])

/** Storage keys whose changes need syncing (everything an item is read from) */
export const isSyncedKey = (key) =>
  typeof key === 'string' &&
  !DEVICE_KEYS.has(key) &&
  (key === 'nuzlocke.saves' ||
    key === 'nuzlocke.knowledge' ||
    key === 'nuzlocke.archive' ||
    /^nuzlocke\.archive\.[A-Za-z0-9-]+$/.test(key) ||
    /^nuzlocke\.[A-Za-z0-9-]{1,64}(\.(unbound|attempt))?$/.test(key))

const num = (v) => (Number.isFinite(v) ? v : 0)

export function loadState(storage) {
  const c = readJSON(storage, SYNC_KEYS.config).value
  const b = readJSON(storage, SYNC_KEYS.base).value
  const x = readJSON(storage, SYNC_KEYS.conflicts).value
  const config = isPlainObject(c) ? { ...c, cursor: num(c.cursor) } : null
  const base = {}
  for (const [id, v] of Object.entries(isPlainObject(b) ? b : {}))
    if (isPlainObject(v) && Number.isInteger(v.rev) && (v.hash === null || typeof v.hash === 'string')) base[id] = { rev: v.rev, hash: v.hash }
  const conflicts = Array.isArray(x) ? x.filter((v) => isPlainObject(v) && typeof v.id === 'string' && Number.isInteger(v.rev)) : []
  return { config, base, conflicts }
}

export function saveState(storage, { config, base, conflicts }) {
  transact(storage, [
    { key: SYNC_KEYS.config, raw: config ? stringify(config, 'sync settings') : null },
    { key: SYNC_KEYS.base, raw: config ? stringify(base || {}, 'sync state') : null },
    { key: SYNC_KEYS.conflicts, raw: config && conflicts?.length ? stringify(conflicts, 'sync conflicts') : null }
  ])
}

/** Forgets this device's sync settings. Synced data stays on the device. */
export const clearState = (storage) => saveState(storage, { config: null })
