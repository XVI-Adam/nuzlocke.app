// The same storage contract, checked against the in-memory store and - when
// `redis-server` is installed - against real Redis running the production
// Lua scripts (spoken to over RESP instead of Upstash's REST wrapper).
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import net from 'node:net'

import { createMemoryStore } from '../../src/lib/sync/server/store-memory.js'
import { createRedisStore, createUpstashSend } from '../../src/lib/sync/server/store-redis.js'

const EPOCH = 'epoch-aaaaaaaaaaaaaaaa'
const MAX = 1_000_000

// ---- Minimal RESP client: the same `send(args)` shape as Upstash REST

function resp(port) {
  const socket = net.createConnection({ port, host: '127.0.0.1' })
  let buffer = Buffer.alloc(0)
  const waiting = []
  const parse = (buf, i) => {
    const end = buf.indexOf('\r\n', i)
    if (end < 0) return null
    const type = String.fromCharCode(buf[i])
    const line = buf.toString('utf8', i + 1, end)
    if (type === '+') return [line, end + 2]
    if (type === '-') return [new Error(line), end + 2]
    if (type === ':') return [Number(line), end + 2]
    if (type === '$') {
      const n = Number(line)
      if (n < 0) return [null, end + 2]
      if (buf.length < end + 2 + n + 2) return null
      return [buf.toString('utf8', end + 2, end + 2 + n), end + 2 + n + 2]
    }
    if (type === '*') {
      const n = Number(line)
      if (n < 0) return [null, end + 2]
      const out = []
      let at = end + 2
      for (let k = 0; k < n; k++) {
        const r = parse(buf, at)
        if (!r) return null
        out.push(r[0])
        at = r[1]
      }
      return [out, at]
    }
    throw new Error('bad reply')
  }
  socket.on('data', (d) => {
    buffer = Buffer.concat([buffer, d])
    for (;;) {
      const r = waiting.length && parse(buffer, 0)
      if (!r) break
      buffer = buffer.subarray(r[1])
      const { resolve, reject } = waiting.shift()
      r[0] instanceof Error ? reject(r[0]) : resolve(r[0])
    }
  })
  const send = (args) =>
    new Promise((resolve, reject) => {
      waiting.push({ resolve, reject })
      socket.write(`*${args.length}\r\n` + args.map((a) => `$${Buffer.byteLength(String(a))}\r\n${a}\r\n`).join(''))
    })
  return { send, close: () => socket.destroy() }
}

async function startRedis() {
  if (spawnSync('which', ['redis-server']).status !== 0) return null
  const port = 20000 + Math.floor(Math.random() * 20000)
  const proc = spawn('redis-server', ['--port', String(port), '--save', '', '--appendonly', 'no', '--bind', '127.0.0.1'])
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('redis did not start')), 5000)
    proc.stdout.on('data', (d) => String(d).includes('Ready to accept') && (clearTimeout(t), resolve()))
  })
  const client = resp(port)
  return { send: client.send, stop: () => (client.close(), proc.kill()) }
}

const redis = await startRedis()
after(() => redis?.stop())

const backends = [['memory', async () => createMemoryStore()]]
if (redis)
  backends.push([
    'redis',
    async () => {
      await redis.send(['FLUSHALL'])
      return createRedisStore(redis.send)
    }
  ])
else test('redis-server not installed: Lua scripts not exercised', { skip: true }, () => {})

const ct = (s) => `v1.${s.padEnd(30, 'A')}`

for (const [name, make] of backends) {
  test(`${name}: versioned writes, conflicts and pulls`, async () => {
    const store = await make()
    assert.equal(await store.initEpoch(EPOCH), EPOCH)
    assert.equal(await store.initEpoch('other-epoch-xxxxxxx'), EPOCH, 'epoch is set once')

    const r1 = await store.push({ epoch: EPOCH, deviceId: 'd1', requestId: 'req-1', items: [{ id: 'note:lessons:a', base: 0, ct: ct('a1') }, { id: 'run:r', base: 0, ct: ct('r1') }], maxTotal: MAX })
    assert.deepEqual(r1, { status: 'ok', rev: 1 })
    // Same request again (lost reply): same answer, nothing written twice
    assert.deepEqual(await store.push({ epoch: EPOCH, deviceId: 'd1', requestId: 'req-1', items: [{ id: 'note:lessons:a', base: 0, ct: ct('a1') }], maxTotal: MAX }), { status: 'ok', rev: 1 })

    // Stale base: whole batch rejected, nothing written
    const stale = await store.push({ epoch: EPOCH, deviceId: 'd2', requestId: 'req-2', items: [{ id: 'note:lessons:b', base: 0, ct: ct('b1') }, { id: 'note:lessons:a', base: 0, ct: ct('a2') }], maxTotal: MAX })
    assert.deepEqual(stale, { status: 'conflict', ids: ['note:lessons:a'] })
    assert.equal((await store.pull({ since: 1, maxBytes: MAX })).items.length, 0)

    // Tombstone
    assert.deepEqual(await store.push({ epoch: EPOCH, deviceId: 'd1', requestId: 'req-3', items: [{ id: 'note:lessons:a', base: 1, ct: null }], maxTotal: MAX }), { status: 'ok', rev: 2 })
    const all = await store.pull({ since: 0, maxBytes: MAX })
    assert.equal(all.epoch, EPOCH)
    assert.equal(all.head, 2)
    assert.deepEqual(all.items.sort((a, b) => a.rev - b.rev || (a.id < b.id ? -1 : 1)), [
      { id: 'run:r', rev: 1, ct: ct('r1') },
      { id: 'note:lessons:a', rev: 2, ct: null }
    ])
    assert.deepEqual((await store.pull({ since: 2, maxBytes: MAX })).items, [])

    // Wrong epoch
    assert.deepEqual(await store.push({ epoch: 'x'.repeat(20), deviceId: 'd1', requestId: 'req-4', items: [{ id: 'run:r', base: 1, ct: ct('r2') }], maxTotal: MAX }), { status: 'epoch' })
  })

  test(`${name}: archives can be created and deleted, never replaced`, async () => {
    const store = await make()
    await store.initEpoch(EPOCH)
    const push = (requestId, items) => store.push({ epoch: EPOCH, deviceId: 'd', requestId, items, maxTotal: MAX })
    assert.equal((await push('a-1', [{ id: 'archive:x', base: 0, ct: ct('x1'), imm: true }])).status, 'ok')
    assert.deepEqual(await push('a-2', [{ id: 'archive:x', base: 1, ct: ct('x2'), imm: true }]), { status: 'conflict', ids: ['archive:x'] })
    assert.equal((await push('a-3', [{ id: 'archive:x', base: 1, ct: null, imm: true }])).status, 'ok')
    assert.equal((await push('a-4', [{ id: 'archive:x', base: 2, ct: ct('x3'), imm: true }])).status, 'ok', 'restoring a deleted archive is an explicit choice')
  })

  test(`${name}: pages never split a revision, and the size quota holds`, async () => {
    const store = await make()
    await store.initEpoch(EPOCH)
    const big = (s) => `v1.${s}${'B'.repeat(100)}`
    await store.push({ epoch: EPOCH, deviceId: 'd', requestId: 'p-1', items: [{ id: 'run:a', base: 0, ct: big('a') }, { id: 'run:b', base: 0, ct: big('b') }], maxTotal: MAX })
    await store.push({ epoch: EPOCH, deviceId: 'd', requestId: 'p-2', items: [{ id: 'run:c', base: 0, ct: big('c') }], maxTotal: MAX })
    const p1 = await store.pull({ since: 0, maxBytes: 150 })
    assert.equal(p1.items.length, 2, 'both items of revision 1, although over the page size')
    assert.equal(p1.more, true)
    assert.equal(p1.next, 1)
    const p2 = await store.pull({ since: p1.next, maxBytes: 150 })
    assert.deepEqual(p2.items.map((i) => i.id), ['run:c'])
    assert.equal(p2.more, false)
    assert.equal(p2.next, 2)

    assert.deepEqual(await store.push({ epoch: EPOCH, deviceId: 'd', requestId: 'p-3', items: [{ id: 'run:d', base: 0, ct: big('d'.repeat(1000)) }], maxTotal: 500 }), { status: 'quota' })
    // Deleting frees space
    assert.equal((await store.push({ epoch: EPOCH, deviceId: 'd', requestId: 'p-4', items: [{ id: 'run:a', base: 1, ct: null }], maxTotal: 300 })).status, 'ok')
  })

  test(`${name}: devices, single-use pairing, rate counters and reset`, async () => {
    const store = await make()
    await store.initEpoch(EPOCH)
    assert.equal(await store.addDevice('h1', { id: 'dev1', name: 'A', createdAt: 1, lastSeen: 1 }, 2), true)
    assert.equal(await store.addDevice('h2', { id: 'dev2', name: 'B', createdAt: 2, lastSeen: 2 }, 2), true)
    assert.equal(await store.addDevice('h3', { id: 'dev3', name: 'C', createdAt: 3, lastSeen: 3 }, 2), false)
    assert.equal((await store.getDevice('h1')).name, 'A')
    assert.equal(await store.removeDevice('dev1'), true)
    assert.equal(await store.getDevice('h1'), null)
    await store.touchDevice('h1', { id: 'dev1', name: 'A', lastSeen: 9 })
    assert.equal(await store.getDevice('h1'), null, 'a revoked device is not revived by a late touch')
    assert.deepEqual((await store.listDevices()).map((d) => d.id), ['dev2'])

    await store.createPairing(EPOCH, 'ph', 'dev2', 60)
    assert.equal(await store.consumePairing(EPOCH, 'ph'), 'dev2')
    assert.equal(await store.consumePairing(EPOCH, 'ph'), null)

    assert.equal(await store.hit('bucket', 60), 1)
    assert.equal(await store.hit('bucket', 60), 2)

    await store.push({ epoch: EPOCH, deviceId: 'd', requestId: 'r-1', items: [{ id: 'run:a', base: 0, ct: ct('a') }], maxTotal: MAX })
    await store.reset('epoch-bbbbbbbbbbbbbbbb')
    assert.equal(await store.getEpoch(), 'epoch-bbbbbbbbbbbbbbbb')
    assert.deepEqual((await store.pull({ since: 0, maxBytes: MAX })).items, [])
    assert.deepEqual(await store.listDevices(), [])
  })
}

test('Upstash REST: commands go in the body with a bearer token; failures become storage errors', async () => {
  const calls = []
  const fetch = async (url, init) => {
    calls.push({ url, init })
    return new Response(JSON.stringify({ result: 'OK' }), { status: 200 })
  }
  const send = createUpstashSend({ url: 'https://example.upstash.io', token: 'tkn', fetch })
  assert.equal(await send(['GET', 'k']), 'OK')
  assert.equal(calls[0].url, 'https://example.upstash.io')
  assert.equal(calls[0].init.headers.authorization, 'Bearer tkn')
  assert.equal(calls[0].init.body, '["GET","k"]')

  const failing = createUpstashSend({ url: 'https://x', token: 't', fetch: async () => new Response(JSON.stringify({ error: 'ERR' }), { status: 400 }) })
  await assert.rejects(failing(['GET', 'k']), (e) => e.name === 'StoreError')
  const down = createUpstashSend({ url: 'https://x', token: 't', fetch: async () => { throw new TypeError('fetch failed') } })
  await assert.rejects(down(['GET', 'k']), (e) => e.name === 'StoreError')
})

test('redis: two devices sync end to end (pairing, edits, conflicts, deletion, archiving)', { skip: !redis }, async () => {
  const { createServer, device, seeded, MemoryStorage, RUN, NEW_RUN } = await import('./helpers.mjs')
  const { beginConnect, completeConnect, createPairingCode } = await import('../../src/lib/sync/device.js')
  const { readKnowledge, writeKnowledge, upsert, remove } = await import('../../src/lib/history/knowledge.js')
  const { archiveAndStartNew, readArchive } = await import('../../src/lib/history/archive.js')
  await redis.send(['FLUSHALL'])
  const server = createServer({ store: createRedisStore(redis.send) })
  const N = '50000000-0000-4000-8000-000000000001'
  const note = (s, text, now) => writeKnowledge(s, upsert(readKnowledge(s).knowledge, 'lessons', { id: N, text }, now))
  const text = (s) => readKnowledge(s).knowledge.lessons.find((l) => l.id === N)?.text

  const cs = seeded()
  note(cs, 'v1', 1)
  const computer = device(server, cs)
  await computer.connectNew()
  const { code } = await createPairingCode(cs, computer.opts)
  const ps = new MemoryStorage()
  await beginConnect(ps, { method: 'pairing', pairingCode: code, name: 'Phone' }, computer.opts)
  await completeConnect(ps, {}, computer.opts)
  const phone = device(server, ps)
  assert.equal(text(ps), 'v1')

  note(cs, 'computer', 2)
  note(ps, 'phone', 3)
  await computer.sync()
  const res = await phone.sync()
  assert.deepEqual(res.conflicts.map((c) => c.id), [`note:lessons:${N}`])
  await phone.sync({ decisions: { [`note:lessons:${N}`]: 'local' } })
  await computer.sync()
  assert.equal(text(cs), 'phone')

  archiveAndStartNew(cs, { runId: RUN, newRunId: NEW_RUN, now: 5 })
  writeKnowledge(cs, remove(readKnowledge(cs).knowledge, 'lessons', N))
  await computer.sync()
  await phone.sync()
  assert.equal(text(ps), undefined)
  assert.deepEqual(readArchive(ps, RUN).data, readArchive(cs, RUN).data)
  assert.equal(ps.getItem('nuzlocke'), NEW_RUN)
})
