// In-process sync storage with the same behaviour as ./store-redis.js. Used
// by tests, and by `vite dev` when no Redis is configured. Never used in
// production: data is lost when the process restarts.

export function createMemoryStore({ now = () => Date.now() } = {}) {
  let meta = { epoch: null, rev: 0, bytes: 0 }
  let ct = new Map() // id -> ciphertext ('' = deleted)
  let rv = new Map() // id -> rev
  let dev = new Map() // hash -> device
  const expiring = new Map() // key -> { value, until }
  const failures = { next: 0 } // tests: make the next N calls throw

  const fail = () => {
    if (failures.next > 0) {
      failures.next--
      const e = new Error('storage-error')
      e.name = 'StoreError'
      throw e
    }
  }
  const getExp = (key) => {
    const e = expiring.get(key)
    if (!e) return null
    if (e.until <= now()) {
      expiring.delete(key)
      return null
    }
    return e.value
  }
  const setExp = (key, value, seconds) => expiring.set(key, { value, until: now() + seconds * 1000 })

  return {
    failures,
    async getEpoch() {
      fail()
      return meta.epoch
    },
    async initEpoch(epoch) {
      fail()
      if (!meta.epoch) meta.epoch = epoch
      return meta.epoch
    },
    async getDevice(hash) {
      fail()
      return dev.has(hash) ? { ...dev.get(hash) } : null
    },
    async addDevice(hash, device, max) {
      fail()
      if (dev.size >= max) return false
      dev.set(hash, { ...device })
      return true
    },
    async touchDevice(hash, device) {
      fail()
      if (dev.has(hash)) dev.set(hash, { ...device })
    },
    async listDevices() {
      fail()
      return [...dev.values()].map((d) => ({ ...d }))
    },
    async removeDevice(deviceId) {
      fail()
      for (const [hash, d] of dev) if (d.id === deviceId) return dev.delete(hash)
      return false
    },
    async createPairing(epoch, hash, creatorId, ttlSeconds) {
      fail()
      setExp(`pair:${epoch}:${hash}`, creatorId, ttlSeconds)
    },
    async consumePairing(epoch, hash) {
      fail()
      const v = getExp(`pair:${epoch}:${hash}`)
      expiring.delete(`pair:${epoch}:${hash}`)
      return v
    },
    async push({ epoch, deviceId, requestId, items, maxTotal }) {
      fail()
      if (meta.epoch !== epoch) return { status: 'epoch' }
      const reqKey = `req:${epoch}:${deviceId}:${requestId}`
      const done = getExp(reqKey)
      if (done !== null) return { status: 'ok', rev: Number(done) }
      const conflicts = []
      let delta = 0
      for (const it of items) {
        const cur = rv.get(it.id) || 0
        const old = ct.get(it.id) || ''
        const val = it.ct ?? ''
        if (cur !== it.base || (it.imm && old !== '' && val !== '')) conflicts.push(it.id)
        delta += val.length - old.length
      }
      if (conflicts.length) return { status: 'conflict', ids: conflicts }
      if (delta > 0 && meta.bytes + delta > maxTotal) return { status: 'quota' }
      const rev = ++meta.rev
      for (const it of items) {
        ct.set(it.id, it.ct ?? '')
        rv.set(it.id, rev)
      }
      meta.bytes += delta
      setExp(reqKey, String(rev), 86400)
      return { status: 'ok', rev }
    },
    async pull({ since, maxBytes }) {
      fail()
      const ids = [...rv.entries()].filter(([, r]) => r > since).sort((a, b) => a[1] - b[1] || (a[0] < b[0] ? -1 : 1))
      const items = []
      let bytes = 0,
        last = null,
        more = false,
        next = meta.rev
      for (const [id, rev] of ids) {
        const val = ct.get(id) || ''
        if (last !== null && rev !== last && bytes + val.length > maxBytes) {
          more = true
          next = last
          break
        }
        bytes += val.length
        last = rev
        items.push({ id, rev, ct: val || null })
      }
      return { epoch: meta.epoch, head: meta.rev, more, next, items }
    },
    async hit(bucket, windowSeconds) {
      fail()
      const key = `rl:${bucket}`
      const n = Number(getExp(key) || 0) + 1
      if (n === 1) setExp(key, '1', windowSeconds)
      else expiring.get(key).value = String(n)
      return n
    },
    async reset(epoch) {
      fail()
      meta = { epoch, rev: 0, bytes: 0 }
      ct = new Map()
      rv = new Map()
      dev = new Map()
    },
    /** Tests only: the raw stored ciphertexts, and tampering with them */
    _dump: () => ({ meta: { ...meta }, ct: new Map(ct), rv: new Map(rv) }),
    _set: (id, value) => {
      ct.set(id, value)
      rv.set(id, ++meta.rev)
    }
  }
}
