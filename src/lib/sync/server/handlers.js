// Server side of cross-device sync: POST /api/sync/<op>.
//
// Security model
// - The server stores and returns only ciphertext (see $lib/sync/crypto). It
//   sees item ids (kind + random uuid), sizes, revisions, device names and
//   request times - never notes, runs or saves.
// - SYNC_SETUP_KEY (>= 32 chars, different from UNBOUND_SYNC_KEY) is needed
//   only to enrol a device without a pairing code, and to reset the dataset.
//   Missing or short: sync is disabled (fail closed).
// - Every enrolled device has its own random token; only its SHA-256 is
//   stored, so a storage leak doesn't reveal usable tokens. Revoking a device
//   deletes its entry. Pairing secrets are single-use and expire in 15 min.
// - Tokens and keys travel only in the Authorization header; they are never
//   logged, echoed or put in URLs. Errors are short codes.
// - Bodies are size-capped and strictly validated; requests are rate limited
//   per device and per (hashed) client address. Responses are never cached.
// - Archived attempts and the key check are create-only on the server too.
import { createHash, randomBytes } from 'node:crypto'

import { isAuthorized, MIN_KEY_LENGTH } from '../../unbound/server/save-endpoint.js'
import { ITEM_ID_RE, CT_RE, TOKEN_RE, PAIR_RE, REQUEST_ID_RE, EPOCH_RE, LIMITS, isImmutableId, cleanDeviceName } from '../protocol.js'

export const OPS = ['enroll', 'pair', 'devices', 'pull', 'push', 'reset']
const PAIR_TTL = 15 * 60
const TOUCH_EVERY = 5 * 60 * 1000

export const RATES = {
  device: { limit: 120, window: 60 }, // sync requests per device per minute
  setup: { limit: 10, window: 15 * 60 }, // setup-key / pairing attempts per address
  authFail: { limit: 20, window: 15 * 60 }, // bad tokens per address before blocking
  pair: { limit: 10, window: 60 * 60 } // pairing codes per device per hour
}

const sha256 = (s) => createHash('sha256').update(String(s)).digest('hex')
const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const isPlainObject = (o) => !!o && typeof o === 'object' && !Array.isArray(o)

class HttpError extends Error {
  constructor(status, code, extra = {}) {
    super(code)
    this.status = status
    this.code = code
    this.extra = extra
  }
}

export const json = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store, max-age=0',
      pragma: 'no-cache',
      'x-content-type-options': 'nosniff',
      'x-robots-tag': 'noindex'
    }
  })

async function readBody(request) {
  if (!(request.headers.get('content-type') || '').toLowerCase().startsWith('application/json')) throw new HttpError(415, 'bad-request')
  const declared = Number(request.headers.get('content-length'))
  if (declared > LIMITS.bodyBytes) throw new HttpError(413, 'too-large')
  if (!request.body) throw new HttpError(400, 'bad-request')
  const reader = request.body.getReader()
  const chunks = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > LIMITS.bodyBytes) {
      await reader.cancel()
      throw new HttpError(413, 'too-large')
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const c of chunks) {
    bytes.set(c, offset)
    offset += c.byteLength
  }
  let body
  try {
    body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  } catch {
    throw new HttpError(400, 'bad-request')
  }
  if (!isPlainObject(body)) throw new HttpError(400, 'bad-request')
  return body
}

const bearer = (request) => /^Bearer ([^\s]+)$/.exec(request.headers.get('authorization') || '')?.[1] || null

function validatePush(body) {
  const { epoch, requestId, items } = body
  if (typeof epoch !== 'string' || !EPOCH_RE.test(epoch)) throw new HttpError(400, 'bad-request')
  if (typeof requestId !== 'string' || !REQUEST_ID_RE.test(requestId)) throw new HttpError(400, 'bad-request')
  if (!Array.isArray(items) || !items.length) throw new HttpError(400, 'bad-request')
  if (items.length > LIMITS.pushItems) throw new HttpError(413, 'too-large')
  const seen = new Set()
  return items.map((it) => {
    if (!isPlainObject(it) || typeof it.id !== 'string' || !ITEM_ID_RE.test(it.id) || seen.has(it.id)) throw new HttpError(400, 'bad-request')
    if (!Number.isSafeInteger(it.base) || it.base < 0) throw new HttpError(400, 'bad-request')
    if (it.ct !== null && (typeof it.ct !== 'string' || !CT_RE.test(it.ct))) throw new HttpError(400, 'bad-request')
    if (it.ct && it.ct.length > LIMITS.itemChars) throw new HttpError(413, 'too-large')
    seen.add(it.id)
    return { id: it.id, base: it.base, ct: it.ct, imm: isImmutableId(it.id) }
  })
}

/**
 * @param getEnv   () => ({ SYNC_SETUP_KEY, UNBOUND_SYNC_KEY })
 * @param getStore () => store | null (null: storage not configured)
 * @param log      receives only short error codes
 */
export function createSyncHandler({ getEnv, getStore, log = console.error, now = () => Date.now() }) {
  return async (event) => {
    const { request, params } = event
    const op = params?.op
    try {
      if (!OPS.includes(op)) throw new HttpError(404, 'not-found')
      const { SYNC_SETUP_KEY: setupKey, UNBOUND_SYNC_KEY: saveKey } = getEnv()
      const store = getStore()
      // Separate credentials: never accept the save-fetch key as the sync key
      if (!store || typeof setupKey !== 'string' || setupKey.length < MIN_KEY_LENGTH || setupKey === saveKey) throw new HttpError(503, 'not-configured')

      let address = 'unknown'
      try {
        address = event.getClientAddress?.() || 'unknown'
      } catch {
        // not available (tests, some adapters)
      }
      const addr = sha256(`addr:${address}`).slice(0, 24)
      const limited = async (bucket, rate) => (await store.hit(bucket, rate.window)) > rate.limit

      const body = await readBody(request)

      if (op === 'enroll' || op === 'reset') {
        if (await limited(`setup:${addr}`, RATES.setup)) throw new HttpError(429, 'rate-limited')
        const name = cleanDeviceName(body.name) || 'Device'

        if (op === 'reset') {
          if (!isAuthorized(request.headers.get('authorization'), setupKey)) throw new HttpError(401, 'bad-setup-key')
          if (body.confirm !== 'RESET') throw new HttpError(400, 'bad-request')
          const epoch = b64url(randomBytes(18))
          await store.reset(epoch)
          return json(200, { ok: true, epoch })
        }

        let epoch, via
        if (body.pair !== undefined) {
          if (typeof body.pair !== 'string' || !PAIR_RE.test(body.pair)) throw new HttpError(400, 'bad-request')
          epoch = await store.getEpoch()
          const creator = epoch ? await store.consumePairing(epoch, sha256(body.pair)) : null
          // A code made by a device that was revoked since is void too
          if (!creator || !(await store.listDevices()).some((d) => d.id === creator)) throw new HttpError(403, 'bad-pairing')
          via = 'pairing'
        } else {
          if (!isAuthorized(request.headers.get('authorization'), setupKey)) throw new HttpError(401, 'bad-setup-key')
          epoch = await store.initEpoch(b64url(randomBytes(18)))
          via = 'setup key'
        }
        const token = b64url(randomBytes(32))
        const device = { id: b64url(randomBytes(9)), name, createdAt: now(), lastSeen: now(), via }
        if (!(await store.addDevice(sha256(token), device, LIMITS.devices))) throw new HttpError(409, 'too-many-devices')
        return json(200, { token, deviceId: device.id, epoch })
      }

      // Everything else needs a device token
      const token = bearer(request)
      const hash = token && TOKEN_RE.test(token) ? sha256(token) : null
      const device = hash ? await store.getDevice(hash) : null
      if (!device) {
        if (await limited(`authfail:${addr}`, RATES.authFail)) throw new HttpError(429, 'rate-limited')
        throw new HttpError(401, 'unauthorized')
      }
      if (await limited(`dev:${device.id}`, RATES.device)) throw new HttpError(429, 'rate-limited')
      if (now() - (device.lastSeen || 0) > TOUCH_EVERY) await store.touchDevice(hash, { ...device, lastSeen: now() })

      if (op === 'pull') {
        const since = body.since
        if (!Number.isSafeInteger(since) || since < 0) throw new HttpError(400, 'bad-request')
        return json(200, await store.pull({ since, maxBytes: LIMITS.pullBytes }))
      }

      if (op === 'push') {
        const items = validatePush(body)
        const res = await store.push({ epoch: body.epoch, deviceId: device.id, requestId: body.requestId, items, maxTotal: LIMITS.totalBytes })
        if (res.status === 'ok') return json(200, { ok: true, rev: res.rev })
        if (res.status === 'conflict') throw new HttpError(409, 'conflict', { ids: res.ids })
        if (res.status === 'epoch') throw new HttpError(409, 'epoch')
        if (res.status === 'quota') throw new HttpError(413, 'quota')
        throw new HttpError(500, 'internal')
      }

      if (op === 'pair') {
        if (await limited(`pair:${device.id}`, RATES.pair)) throw new HttpError(429, 'rate-limited')
        const epoch = await store.getEpoch()
        const pair = b64url(randomBytes(18))
        await store.createPairing(epoch, sha256(pair), device.id, PAIR_TTL)
        return json(200, { pair, expiresAt: now() + PAIR_TTL * 1000 })
      }

      // devices
      if (body.action === 'list') {
        const devices = (await store.listDevices())
          .map((d) => ({ id: d.id, name: d.name, createdAt: d.createdAt, lastSeen: d.lastSeen, via: d.via, current: d.id === device.id }))
          .sort((a, b) => a.createdAt - b.createdAt)
        return json(200, { devices })
      }
      if (body.action === 'revoke') {
        if (typeof body.deviceId !== 'string' || !/^[A-Za-z0-9_-]{8,32}$/.test(body.deviceId)) throw new HttpError(400, 'bad-request')
        return json(200, { ok: true, revoked: await store.removeDevice(body.deviceId) })
      }
      throw new HttpError(400, 'bad-request')
    } catch (e) {
      if (e instanceof HttpError) return json(e.status, { error: e.code, ...e.extra })
      const code = e?.name === 'StoreError' ? 'storage-error' : 'internal'
      log(`[sync] ${op} ${code}`)
      return json(code === 'storage-error' ? 503 : 500, { error: code })
    }
  }
}
