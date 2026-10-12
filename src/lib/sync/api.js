// Client for /api/sync/*. Credentials only ever travel in the Authorization
// header of same-origin POST requests; nothing secret goes in a URL.
import { SyncError } from './items.js'
import { randomId } from './crypto.js'

export const MESSAGES = {
  unauthorized: 'This device is no longer authorised to sync (it may have been revoked). Reconnect it from the Devices page.',
  'bad-setup-key': 'That setup key is not correct.',
  'bad-pairing': 'That pairing code has expired or was already used. Create a new one on your other device.',
  'not-configured': 'Sync isn’t set up on the server yet. See the setup steps on this page.',
  'rate-limited': 'Too many requests. Wait a minute and try again.',
  'too-large': 'This data is too large to sync.',
  quota: 'The synced data has reached its storage limit.',
  'too-many-devices': 'Too many devices are connected. Revoke one you no longer use first.',
  epoch: 'The synced data was reset from another device. Reconnect this device to continue syncing.',
  'storage-error': 'The sync server’s storage is unavailable right now.',
  offline: 'You’re offline. Changes are kept on this device and sync when you’re back online.'
}

/** Errors worth retrying later with backoff (vs. ones the player must fix) */
export const isRetryable = (e) => ['offline', 'timeout', 'rate-limited', 'storage-error', 'server-error', 'internal', 'busy'].includes(e?.code)

/**
 * @param opts.token   device token (omit for enrolment)
 * @param opts.fetch   injectable for tests
 */
export function createApi({ token = null, fetch = globalThis.fetch, base = '/api/sync', timeoutMs = 20_000 } = {}) {
  async function call(op, body, auth = token) {
    let res
    try {
      res = await fetch(`${base}/${op}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(auth ? { authorization: `Bearer ${auth}` } : {}) },
        body: JSON.stringify(body || {}),
        cache: 'no-store',
        credentials: 'same-origin',
        signal: AbortSignal.timeout?.(timeoutMs)
      })
    } catch (e) {
      throw new SyncError(e?.name === 'TimeoutError' ? 'timeout' : 'offline', MESSAGES.offline, e)
    }
    let data = null
    try {
      data = await res.json()
    } catch (e) {
      // Fall through: handled by status below
    }
    if (res.status === 409 && data?.error === 'conflict') return { conflict: true, ids: data.ids || [] }
    if (!res.ok) {
      const code = res.status === 429 ? 'rate-limited' : data?.error || (res.status >= 500 ? 'server-error' : `http-${res.status}`)
      const err = new SyncError(code, MESSAGES[code] || `Sync failed (${code}).`)
      err.status = res.status
      throw err
    }
    if (!data || typeof data !== 'object') throw new SyncError('server-error', 'The sync server sent an unreadable reply.')
    return data
  }

  return {
    enroll: ({ setupKey, pair, name }) => call('enroll', { name, ...(pair ? { pair } : {}) }, pair ? null : setupKey),
    pull: ({ since }) => call('pull', { since }),
    /** Retries a lost request once with the same request id, so it is applied at most once */
    push: async ({ epoch, items }) => {
      const requestId = randomId(16)
      try {
        return await call('push', { epoch, requestId, items })
      } catch (e) {
        if (!['offline', 'timeout', 'server-error', 'storage-error'].includes(e.code)) throw e
        return call('push', { epoch, requestId, items })
      }
    },
    pair: () => call('pair', {}),
    devices: () => call('devices', { action: 'list' }),
    revoke: (deviceId) => call('devices', { action: 'revoke', deviceId }),
    reset: ({ setupKey, confirm }) => call('reset', { confirm }, setupKey)
  }
}
