// Connecting, pairing and disconnecting this device. No Svelte: used by the
// Devices page and by tests.
//
// Connecting never changes local data by itself: it enrols the device, then
// `previewConnect` shows what would be uploaded, downloaded or is different,
// and only `completeConnect` (after the player confirms) syncs. Until that
// first sync is confirmed and verified the device stays "not connected" and
// automatic sync is off.
import { createApi } from './api.js'
import { syncCycle } from './engine.js'
import { loadState, saveState, clearState } from './state.js'
import { SyncError } from './items.js'
import { b64url, fromB64url, generateKeyBytes, importKey, encodeRecoveryKey, decodeRecoveryKey, encodePairingCode, decodePairingCode, randomId } from './crypto.js'

const newId = () => globalThis.crypto.randomUUID?.() || [randomId(4), randomId(2), randomId(2), randomId(2), randomId(6)].join('-').replace(/_/g, 'a')

/** Everything syncCycle needs, from the stored settings */
export async function contextFor(storage, { fetch = globalThis.fetch, now = () => Date.now() } = {}) {
  const { config } = loadState(storage)
  if (!config?.token) throw new SyncError('not-connected', 'This device isn’t connected.')
  if (!config.key) throw new SyncError('needs-key', 'Enter the recovery key to finish connecting this device.')
  return { storage, api: createApi({ token: config.token, fetch }), key: await importKey(fromB64url(config.key)), newId, now, config }
}

/**
 * Enrols this device.
 * @param method 'setup' (setup key; new dataset or with recovery key) | 'pairing'
 * @returns {{ needsKey: boolean, newDataset: boolean }}
 */
export async function beginConnect(storage, { method, setupKey, pairingCode, recoveryKey, name }, { fetch = globalThis.fetch } = {}) {
  if (loadState(storage).config?.connected) throw new SyncError('already-connected', 'This device is already connected.')
  const api = createApi({ fetch })
  let keyBytes = null
  let res
  if (method === 'pairing') {
    const decoded = await decodePairingCode(pairingCode)
    keyBytes = decoded.keyBytes
    res = await api.enroll({ pair: decoded.pair, name })
  } else {
    if (recoveryKey) keyBytes = await decodeRecoveryKey(recoveryKey)
    res = await api.enroll({ setupKey, name })
  }

  let newDataset = false
  if (!keyBytes) {
    // Setup key only: start a new encrypted dataset, unless one exists
    const first = await createApi({ token: res.token, fetch }).pull({ since: 0 })
    if (first.items.some((i) => i.id === 'meta:keycheck' && i.ct)) {
      saveState(storage, { config: { version: 1, deviceId: res.deviceId, deviceName: name, token: res.token, epoch: res.epoch, cursor: 0, connected: false, key: null }, base: {}, conflicts: [] })
      return { needsKey: true, newDataset: false }
    }
    keyBytes = generateKeyBytes()
    newDataset = true
  }
  saveState(storage, {
    config: { version: 1, deviceId: res.deviceId, deviceName: name, token: res.token, epoch: res.epoch, cursor: 0, connected: false, key: b64url(keyBytes), newDataset },
    base: {},
    conflicts: []
  })
  return { needsKey: false, newDataset }
}

/** Adds the recovery key to an enrolled device that joined an existing dataset */
export async function provideRecoveryKey(storage, recoveryKey) {
  const state = loadState(storage)
  if (!state.config?.token) throw new SyncError('not-connected', 'Start connecting this device first.')
  const keyBytes = await decodeRecoveryKey(recoveryKey)
  saveState(storage, { ...state, config: { ...state.config, key: b64url(keyBytes) } })
}

/** Dry run of the first sync: nothing is written anywhere */
export async function previewConnect(storage, opts) {
  const ctx = await contextFor(storage, opts)
  return (await syncCycle(ctx, { dryRun: true })).preview
}

/** The confirmed first sync. Only marks the device connected once it succeeded and was verified. */
export async function completeConnect(storage, decisions = {}, opts = {}) {
  const ctx = await contextFor(storage, opts)
  const result = await syncCycle(ctx, { decisions, onApplied: opts.onApplied })
  const state = loadState(storage)
  const config = { ...state.config, connected: true }
  delete config.newDataset
  saveState(storage, { ...state, config })
  return result
}

/** Forgets the sync settings here (synced data stays) and revokes this device, best effort */
export async function disconnect(storage, { fetch = globalThis.fetch, revoke = true } = {}) {
  const { config } = loadState(storage)
  if (config?.token && revoke) {
    try {
      await createApi({ token: config.token, fetch }).revoke(config.deviceId)
    } catch (e) {
      // Already revoked or offline: it can be revoked from another device
    }
  }
  clearState(storage)
}

/** A one-time code for adding another device; holds the encryption key, so show it only to the player */
export async function createPairingCode(storage, opts = {}) {
  const { config } = loadState(storage)
  if (!config?.connected || !config.key) throw new SyncError('not-connected', 'Connect this device first.')
  const res = await createApi({ token: config.token, fetch: opts.fetch || globalThis.fetch }).pair()
  return { code: await encodePairingCode(res.pair, fromB64url(config.key)), expiresAt: res.expiresAt }
}

export async function recoveryKeyFor(storage) {
  const { config } = loadState(storage)
  if (!config?.key) throw new SyncError('not-connected', 'This device has no sync key.')
  return encodeRecoveryKey(fromB64url(config.key))
}
