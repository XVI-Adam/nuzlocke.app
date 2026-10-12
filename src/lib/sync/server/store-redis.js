// Sync storage on Redis (Upstash, via its REST API - no client library).
// Writes that must be atomic (push, pull, single-use pairing) run as Lua
// scripts, so concurrent devices can't interleave.
//
//   nzs:meta              hash  epoch, rev (last revision), bytes (stored size)
//   nzs:ct                hash  item id -> ciphertext ("" = deleted)
//   nzs:rv                zset  item id scored by its revision
//   nzs:dev               hash  sha256(device token) -> device JSON
//   nzs:pair:<ep>:<hash>  string, expires: one-time pairing secret -> creator id
//   nzs:req:<ep>:<dev>:<request id>  string, expires: revision of an applied push
//   nzs:rl:<bucket>       counter, expires: rate limiting
//
// The server only ever holds ciphertext; nothing here can read item contents.

export class StoreError extends Error {
  constructor(message = 'storage-error', cause) {
    super(message)
    this.name = 'StoreError'
    this.cause = cause
  }
}

const K = {
  meta: 'nzs:meta',
  ct: 'nzs:ct',
  rv: 'nzs:rv',
  dev: 'nzs:dev',
  pair: (epoch, hash) => `nzs:pair:${epoch}:${hash}`,
  req: (epoch, device, id) => `nzs:req:${epoch}:${device}:${id}`,
  rl: (bucket) => `nzs:rl:${bucket}`
}

// KEYS: meta, ct, rv, req   ARGV: epoch, maxTotal, n, then n x (id, base, ct, imm)
const PUSH = `
if redis.call('HGET', KEYS[1], 'epoch') ~= ARGV[1] then return {'epoch'} end
local done = redis.call('GET', KEYS[4])
if done then return {'ok', done} end
local n = tonumber(ARGV[3])
local conflicts = {}
local delta = 0
for i = 0, n - 1 do
  local id = ARGV[4 + i * 4]
  local base = tonumber(ARGV[5 + i * 4])
  local val = ARGV[6 + i * 4]
  local cur = tonumber(redis.call('ZSCORE', KEYS[3], id) or '0')
  local old = redis.call('HGET', KEYS[2], id) or ''
  if cur ~= base or (ARGV[7 + i * 4] == '1' and old ~= '' and val ~= '') then
    table.insert(conflicts, id)
  end
  delta = delta + string.len(val) - string.len(old)
end
if #conflicts > 0 then
  table.insert(conflicts, 1, 'conflict')
  return conflicts
end
local total = tonumber(redis.call('HGET', KEYS[1], 'bytes') or '0')
if delta > 0 and total + delta > tonumber(ARGV[2]) then return {'quota'} end
local rev = redis.call('HINCRBY', KEYS[1], 'rev', 1)
for i = 0, n - 1 do
  redis.call('HSET', KEYS[2], ARGV[4 + i * 4], ARGV[6 + i * 4])
  redis.call('ZADD', KEYS[3], rev, ARGV[4 + i * 4])
end
redis.call('HINCRBY', KEYS[1], 'bytes', delta)
redis.call('SET', KEYS[4], tostring(rev), 'EX', 86400)
return {'ok', tostring(rev)}
`

// KEYS: meta, ct, rv   ARGV: since, maxBytes
// Returns epoch, head, more, next, then (id, rev, ct) triples. Items of one
// revision (one push) are never split across pages.
const PULL = `
local epoch = redis.call('HGET', KEYS[1], 'epoch') or ''
local head = redis.call('HGET', KEYS[1], 'rev') or '0'
local ids = redis.call('ZRANGEBYSCORE', KEYS[3], '(' .. ARGV[1], '+inf', 'WITHSCORES')
local out = {epoch, head, '0', head}
local bytes = 0
local last = nil
local max = tonumber(ARGV[2])
for i = 1, #ids, 2 do
  local rev = ids[i + 1]
  local val = redis.call('HGET', KEYS[2], ids[i]) or ''
  if last ~= nil and rev ~= last and bytes + string.len(val) > max then
    out[3] = '1'
    out[4] = last
    break
  end
  bytes = bytes + string.len(val)
  last = rev
  table.insert(out, ids[i])
  table.insert(out, rev)
  table.insert(out, val)
end
return out
`

// KEYS: counter   ARGV: window seconds
const HIT = `
local n = redis.call('INCR', KEYS[1])
if n == 1 then redis.call('EXPIRE', KEYS[1], tonumber(ARGV[1])) end
return n
`

// KEYS: meta, ct, rv, dev
const RESET = `
redis.call('DEL', KEYS[2], KEYS[3], KEYS[4])
redis.call('DEL', KEYS[1])
redis.call('HSET', KEYS[1], 'epoch', ARGV[1], 'rev', '0', 'bytes', '0')
return 'ok'
`

/** `send(args[])` runs one Redis command and returns its result */
export function createUpstashSend({ url, token, fetch = globalThis.fetch, timeoutMs = 10_000 }) {
  return async (args) => {
    let res, data
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify(args),
        signal: AbortSignal.timeout(timeoutMs)
      })
      data = await res.json()
    } catch (e) {
      throw new StoreError('storage-error', e)
    }
    if (!res.ok || !data || data.error !== undefined) throw new StoreError('storage-error')
    return data.result
  }
}

export function createRedisStore(send) {
  const run = async (args) => {
    try {
      return await send(args)
    } catch (e) {
      throw e instanceof StoreError ? e : new StoreError('storage-error', e)
    }
  }
  const evalScript = (script, keys, args) => run(['EVAL', script, String(keys.length), ...keys, ...args.map(String)])

  return {
    async getEpoch() {
      return (await run(['HGET', K.meta, 'epoch'])) || null
    },
    async initEpoch(epoch) {
      await run(['HSETNX', K.meta, 'epoch', epoch])
      return run(['HGET', K.meta, 'epoch'])
    },
    async getDevice(hash) {
      const raw = await run(['HGET', K.dev, hash])
      try {
        return raw ? JSON.parse(raw) : null
      } catch {
        return null
      }
    },
    async addDevice(hash, device, max) {
      if ((await run(['HLEN', K.dev])) >= max) return false
      await run(['HSET', K.dev, hash, JSON.stringify(device)])
      return true
    },
    async touchDevice(hash, device) {
      // Only if it still exists: a revoked device must not come back
      await evalScript(`if redis.call('HEXISTS', KEYS[1], ARGV[1]) == 1 then redis.call('HSET', KEYS[1], ARGV[1], ARGV[2]) end return 1`, [K.dev], [hash, JSON.stringify(device)])
    },
    async listDevices() {
      const flat = (await run(['HGETALL', K.dev])) || []
      const out = []
      for (let i = 1; i < flat.length; i += 2) {
        try {
          out.push(JSON.parse(flat[i]))
        } catch {
          // skip unreadable entries
        }
      }
      return out
    },
    async removeDevice(deviceId) {
      const flat = (await run(['HGETALL', K.dev])) || []
      for (let i = 0; i < flat.length; i += 2) {
        let d = null
        try {
          d = JSON.parse(flat[i + 1])
        } catch {
          // ignore
        }
        if (d?.id === deviceId) return (await run(['HDEL', K.dev, flat[i]])) > 0
      }
      return false
    },
    async createPairing(epoch, hash, creatorId, ttlSeconds) {
      await run(['SET', K.pair(epoch, hash), creatorId, 'EX', String(ttlSeconds)])
    },
    async consumePairing(epoch, hash) {
      return (await run(['GETDEL', K.pair(epoch, hash)])) || null
    },
    async push({ epoch, deviceId, requestId, items, maxTotal }) {
      const args = [epoch, maxTotal, items.length]
      for (const it of items) args.push(it.id, it.base, it.ct ?? '', it.imm ? '1' : '0')
      const res = await evalScript(PUSH, [K.meta, K.ct, K.rv, K.req(epoch, deviceId, requestId)], args)
      if (!Array.isArray(res)) throw new StoreError('storage-error')
      if (res[0] === 'ok') return { status: 'ok', rev: Number(res[1]) }
      if (res[0] === 'conflict') return { status: 'conflict', ids: res.slice(1) }
      return { status: res[0] }
    },
    async pull({ since, maxBytes }) {
      const res = await evalScript(PULL, [K.meta, K.ct, K.rv], [since, maxBytes])
      if (!Array.isArray(res) || res.length < 4) throw new StoreError('storage-error')
      const items = []
      for (let i = 4; i + 2 < res.length; i += 3) items.push({ id: res[i], rev: Number(res[i + 1]), ct: res[i + 2] || null })
      return { epoch: res[0] || null, head: Number(res[1]), more: res[2] === '1', next: Number(res[3]), items }
    },
    async hit(bucket, windowSeconds) {
      return Number(await evalScript(HIT, [K.rl(bucket)], [windowSeconds]))
    },
    async reset(epoch) {
      await evalScript(RESET, [K.meta, K.ct, K.rv, K.dev], [epoch])
    }
  }
}
