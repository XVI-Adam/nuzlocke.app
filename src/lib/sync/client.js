// Automatic sync in the browser: after local changes (debounced), on start,
// when the app comes back to the foreground or online, every few minutes
// while visible, and on demand. Browser-only; loaded lazily by the app layout.
//
// Status (`syncStatus.state`):
//   off       this device isn't connected
//   syncing   a sync is running, or local changes are waiting to be uploaded
//   synced    the server confirmed (and this device read back) everything
//   offline   no connection; changes stay here and sync later
//   conflict  synced, except items that need a choice on the Devices page
//   error     needs attention (message says what); retried when it may help
import { syncStatus } from './status.js'
import { loadState, saveState, isSyncedKey } from './state.js'
import { contextFor } from './device.js'
import { syncCycle } from './engine.js'
import { isRetryable, MESSAGES } from './api.js'

export { syncStatus }

const DEBOUNCE_MS = 3000
const POLL_MS = 3 * 60 * 1000
const BACKOFF_MS = [5_000, 15_000, 60_000, 5 * 60_000]

let started = false,
  debounce = null,
  retry = null,
  running = null,
  again = false,
  failures = 0

const storage = () => window.localStorage
const connected = () => !!loadState(storage()).config?.connected

function setStatus(state, extra = {}) {
  const s = loadState(storage())
  syncStatus.set({ state, message: null, lastSyncedAt: s.config?.lastSyncedAt || null, conflicts: s.conflicts.length, ...extra })
}

/** Re-reads what's on screen after other devices' changes were written here */
async function refreshPage(ids, activeBefore) {
  // The run open on this page was archived or deleted on another device:
  // reload, so nothing keeps editing it from memory
  if (window.localStorage.getItem('nuzlocke') !== activeBefore) return window.location.reload()
  const [{ reloadFromStorage }, { reloadNotes }] = await Promise.all([import('$lib/store'), import('$lib/components/History/notes-store')])
  reloadFromStorage()
  reloadNotes()
  window.dispatchEvent(new CustomEvent('nuzlocke:synced', { detail: { ids } }))
}

/** Upload soon: called for every write to a synced storage key */
export function schedule(delay = DEBOUNCE_MS) {
  if (!connected()) return
  clearTimeout(debounce)
  setStatus('syncing', { pending: true })
  debounce = setTimeout(() => syncNow(), delay)
}

const withLock = (fn) => (navigator.locks?.request ? navigator.locks.request('nuzlocke-sync', fn) : fn())

/**
 * Runs a sync now (or right after the one in progress).
 * @param decisions conflict choices, { [itemId]: 'local' | 'remote' | 'copy' }
 */
export function syncNow({ decisions } = {}) {
  if (typeof window === 'undefined') return Promise.resolve()
  clearTimeout(debounce)
  if (!connected()) {
    setStatus('off')
    return Promise.resolve()
  }
  if (running) {
    again = true
    return running.then(() => (decisions ? syncNow({ decisions }) : undefined))
  }
  if (navigator.onLine === false) {
    setStatus('offline', { message: MESSAGES.offline })
    return Promise.resolve()
  }
  clearTimeout(retry)
  setStatus('syncing')
  running = withLock(async () => {
    try {
      const ctx = await contextFor(storage())
      const activeBefore = storage().getItem('nuzlocke')
      const res = await syncCycle(ctx, { decisions, onApplied: (ids) => refreshPage(ids, activeBefore) })
      failures = 0
      setStatus(res.conflicts.length ? 'conflict' : 'synced')
    } catch (e) {
      console.error('[sync]', e?.code || e?.name)
      handleError(e)
    }
  }).finally(() => {
    running = null
    if (again) {
      again = false
      schedule(500)
    }
  })
  return running
}

function handleError(e) {
  if (e?.code === 'unauthorized' || e?.code === 'epoch-changed' || e?.code === 'wrong-key') {
    // Stop syncing until reconnected; local data stays as it is
    const s = loadState(storage())
    if (s.config) saveState(storage(), { ...s, config: { ...s.config, connected: false, stopped: e.message } })
    setStatus('error', { message: e.message, stopped: true })
    return
  }
  const offline = ['offline', 'timeout'].includes(e?.code)
  const message = e?.name === 'StorageError' ? `${e.message}. Nothing was changed.` : e?.message || 'Sync failed.'
  setStatus(offline ? 'offline' : 'error', { message })
  if (isRetryable(e) || e?.name === 'StorageError') {
    retry = setTimeout(() => syncNow(), BACKOFF_MS[Math.min(failures, BACKOFF_MS.length - 1)])
    failures++
  }
}

/** Patches localStorage writes so any change to synced data schedules an upload */
function watchStorage() {
  const proto = Storage.prototype
  const { setItem, removeItem } = proto
  proto.setItem = function (key, value) {
    setItem.call(this, key, value)
    if (this === window.localStorage && isSyncedKey(key)) running ? (again = true) : schedule()
  }
  proto.removeItem = function (key) {
    removeItem.call(this, key)
    if (this === window.localStorage && isSyncedKey(key)) running ? (again = true) : schedule()
  }
  // Changes made in another tab of this app
  window.addEventListener('storage', (e) => {
    if (e.storageArea === window.localStorage && isSyncedKey(e.key)) schedule()
  })
}

export function start() {
  if (started || typeof window === 'undefined') return
  started = true
  watchStorage()
  window.addEventListener('online', () => syncNow())
  window.addEventListener('offline', () => connected() && setStatus('offline', { message: MESSAGES.offline }))
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && syncNow())
  window.addEventListener('pageshow', (e) => e.persisted && syncNow())
  setInterval(() => document.visibilityState === 'visible' && !running && syncNow(), POLL_MS)
  const s = loadState(storage())
  if (s.config?.stopped) setStatus('error', { message: s.config.stopped, stopped: true })
  else syncNow()
}
