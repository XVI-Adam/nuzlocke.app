// The sync status shown in the nav. Kept apart from ./client.js so pages can
// show it without loading the sync engine.
import { writable } from 'svelte/store'

/** { state: 'off' | 'syncing' | 'synced' | 'offline' | 'conflict' | 'error', message, lastSyncedAt, conflicts, pending?, stopped? } */
export const syncStatus = writable({ state: 'off', message: null, lastSyncedAt: null, conflicts: 0 })

export const STATE_LABELS = {
  syncing: 'Syncing…',
  synced: 'Synced',
  offline: 'Offline',
  conflict: 'Needs review',
  error: 'Sync error'
}
