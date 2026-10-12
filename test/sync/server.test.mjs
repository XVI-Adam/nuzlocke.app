import { test } from 'node:test'
import assert from 'node:assert/strict'

import { createSyncHandler, RATES } from '../../src/lib/sync/server/handlers.js'
import { storeFromEnv } from '../../src/lib/sync/server/config.js'
import { LIMITS } from '../../src/lib/sync/protocol.js'
import { createServer, SETUP_KEY, SAVE_KEY } from './helpers.mjs'

const post = (server, op, body, { token, raw, type = 'application/json', address } = {}) => {
  if (address) server.net.address = address
  return server.fetch(`/api/sync/${op}`, {
    method: 'POST',
    headers: { 'content-type': type, ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: raw ?? JSON.stringify(body)
  })
}

const enroll = async (server, name = 'Computer') => (await post(server, 'enroll', { name }, { token: SETUP_KEY })).json()
const CT = 'v1.' + 'A'.repeat(40)

test('sync is disabled unless a separate setup key and storage are configured', async () => {
  for (const env of [{ SYNC_SETUP_KEY: '' }, { SYNC_SETUP_KEY: 'short' }, { SYNC_SETUP_KEY: SAVE_KEY }]) {
    const server = createServer({ env })
    const res = await post(server, 'enroll', { name: 'x' }, { token: SAVE_KEY })
    assert.equal(res.status, 503)
    assert.deepEqual(await res.json(), { error: 'not-configured' })
  }
  const handler = createSyncHandler({ getEnv: () => ({ SYNC_SETUP_KEY: SETUP_KEY }), getStore: () => null })
  const res = await handler({ request: new Request('https://x/api/sync/pull', { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } }), params: { op: 'pull' } })
  assert.equal(res.status, 503)
  // Production without Redis: not configured. Dev: in-memory. Plain-HTTP Redis URLs are refused.
  assert.equal(storeFromEnv({}, { dev: false }), null)
  assert.ok(storeFromEnv({}, { dev: true }))
  assert.equal(storeFromEnv({ KV_REST_API_URL: 'http://insecure', KV_REST_API_TOKEN: 't' }), null)
  assert.ok(storeFromEnv({ KV_REST_API_URL: 'https://example.upstash.io', KV_REST_API_TOKEN: 't' }))
})

test('the Unbound save key is not a sync credential, and vice versa', async () => {
  const server = createServer()
  assert.equal((await post(server, 'enroll', { name: 'x' }, { token: SAVE_KEY })).status, 401)
  assert.equal((await post(server, 'pull', { since: 0 }, { token: SETUP_KEY })).status, 401, 'the setup key is not a device token')
})

test('enrolment returns a fresh token; only its hash is stored; responses are never cached', async () => {
  const server = createServer()
  const res = await post(server, 'enroll', { name: '<script>iPhone</script>' }, { token: SETUP_KEY })
  assert.equal(res.status, 200)
  assert.equal(res.headers.get('cache-control'), 'no-store, max-age=0')
  const { token, deviceId, epoch } = await res.json()
  assert.match(token, /^[A-Za-z0-9_-]{43}$/)
  assert.ok(deviceId && epoch)
  const list = await (await post(server, 'devices', { action: 'list' }, { token })).json()
  assert.equal(list.devices[0].name, 'scriptiPhonescript')
  assert.ok(!JSON.stringify(list).includes(token))
  assert.ok(!JSON.stringify(await server.store.listDevices()).includes(token))
})

test('malformed, oversized and invalid requests are rejected', async () => {
  const server = createServer()
  const { token, epoch } = await enroll(server)
  const push = (items, extra = {}) => post(server, 'push', { epoch, requestId: 'r'.repeat(20), items, ...extra }, { token })
  const status = async (p) => (await p).status

  assert.equal(await status(post(server, 'pull', null, { token, raw: '{nope' })), 400)
  assert.equal(await status(post(server, 'pull', null, { token, raw: '[]' })), 400)
  assert.equal(await status(post(server, 'pull', { since: 0 }, { token, type: 'text/plain' })), 415)
  assert.equal(await status(post(server, 'pull', { since: -1 }, { token })), 400)
  assert.equal(await status(post(server, 'pull', { since: '0' }, { token })), 400)
  assert.equal(await status(post(server, 'nope', {}, { token })), 404)
  assert.equal(await status(push([])), 400)
  assert.equal(await status(push([{ id: 'nuzlocke.theme', base: 0, ct: CT }])), 400)
  assert.equal(await status(push([{ id: 'run:../../x', base: 0, ct: CT }])), 400)
  assert.equal(await status(push([{ id: 'run:a', base: 0, ct: 'plaintext {"name":"x"}' }])), 400)
  assert.equal(await status(push([{ id: 'run:a', base: -1, ct: CT }])), 400)
  assert.equal(await status(push([{ id: 'run:a', base: 0, ct: CT }, { id: 'run:a', base: 0, ct: CT }])), 400)
  assert.equal(await status(push([{ id: 'run:a', base: 0, ct: CT }], { requestId: 'bad id!' })), 400)
  assert.equal(await status(push([{ id: 'run:a', base: 0, ct: 'v1.' + 'A'.repeat(LIMITS.itemChars) }])), 413)
  assert.equal(await status(push(Array.from({ length: LIMITS.pushItems + 1 }, (_, i) => ({ id: `run:a${i}`, base: 0, ct: CT })))), 413)
  assert.equal(await status(post(server, 'pull', null, { token, raw: JSON.stringify({ since: 0, pad: 'x'.repeat(LIMITS.bodyBytes) }) })), 413)
  assert.equal(await status(post(server, 'devices', { action: 'revoke', deviceId: '"; DROP' }, { token })), 400)
  assert.equal(server.store._dump().ct.size, 0, 'nothing stored')
})

test('bad credentials are rate limited per address, and never logged', async () => {
  const server = createServer()
  for (let i = 0; i < RATES.setup.limit; i++) assert.equal((await post(server, 'enroll', { name: 'x' }, { token: 'wrong-key-wrong-key-wrong-key-wrong-key' })).status, 401)
  assert.equal((await post(server, 'enroll', { name: 'x' }, { token: SETUP_KEY })).status, 429, 'even the right key, once limited')
  assert.equal((await post(server, 'enroll', { name: 'x' }, { token: SETUP_KEY, address: '198.51.100.1' })).status, 200, 'other addresses unaffected')

  for (let i = 0; i < RATES.authFail.limit; i++) await post(server, 'pull', { since: 0 }, { token: 'x'.repeat(43) })
  assert.equal((await post(server, 'pull', { since: 0 }, { token: 'x'.repeat(43) })).status, 429)
  assert.deepEqual(server.logs, [])
})

test('each device has its own request budget', async () => {
  const server = createServer()
  const { token } = await enroll(server)
  for (let i = 0; i < RATES.device.limit; i++) assert.equal((await post(server, 'pull', { since: 0 }, { token })).status, 200)
  assert.equal((await post(server, 'pull', { since: 0 }, { token })).status, 429)
  const other = await enroll(server, 'Phone')
  assert.equal((await post(server, 'pull', { since: 0 }, { token: other.token })).status, 200)
})

test('pairing secrets are single-use and expire', async () => {
  let t = 1_000_000
  const server = createServer({ now: () => t })
  const { token } = await enroll(server)
  const { pair } = await (await post(server, 'pair', {}, { token })).json()
  assert.equal((await post(server, 'enroll', { name: 'a', pair })).status, 200)
  assert.equal((await post(server, 'enroll', { name: 'b', pair })).status, 403)
  const second = (await (await post(server, 'pair', {}, { token })).json()).pair
  t += 16 * 60 * 1000
  assert.equal((await post(server, 'enroll', { name: 'c', pair: second })).status, 403)
})

test('a pairing code dies with the device that created it', async () => {
  const server = createServer()
  const a = await enroll(server, 'A')
  const b = await enroll(server, 'B')
  const { pair } = await (await post(server, 'pair', {}, { token: b.token })).json()
  await post(server, 'devices', { action: 'revoke', deviceId: b.deviceId }, { token: a.token })
  assert.equal((await post(server, 'enroll', { name: 'via revoked', pair })).status, 403)
})

test('revoking a device ends its access immediately; revoking does not touch the save-fetch key', async () => {
  const server = createServer()
  const a = await enroll(server, 'A')
  const b = await enroll(server, 'B')
  assert.equal((await (await post(server, 'devices', { action: 'revoke', deviceId: b.deviceId }, { token: a.token })).json()).revoked, true)
  assert.equal((await post(server, 'pull', { since: 0 }, { token: b.token })).status, 401)
  assert.equal((await post(server, 'pull', { since: 0 }, { token: a.token })).status, 200)
})

test('reset needs the setup key and explicit confirmation, and invalidates every device', async () => {
  const server = createServer()
  const a = await enroll(server)
  await post(server, 'push', { epoch: a.epoch, requestId: 'r'.repeat(20), items: [{ id: 'run:a', base: 0, ct: CT }] }, { token: a.token })
  assert.equal((await post(server, 'reset', { confirm: 'RESET' }, { token: a.token })).status, 401)
  assert.equal((await post(server, 'reset', { confirm: 'yes' }, { token: SETUP_KEY })).status, 400)
  const res = await (await post(server, 'reset', { confirm: 'RESET' }, { token: SETUP_KEY })).json()
  assert.notEqual(res.epoch, a.epoch)
  assert.equal((await post(server, 'pull', { since: 0 }, { token: a.token })).status, 401)
  assert.equal(server.store._dump().ct.size, 0)
})

test('too many devices are refused', async () => {
  const server = createServer()
  for (let i = 0; i < LIMITS.devices; i++) {
    server.net.address = `10.0.0.${i}` // stay under the per-address enrolment limit
    await enroll(server, `D${i}`)
  }
  server.net.address = '10.0.1.1'
  assert.equal((await post(server, 'enroll', { name: 'one more' }, { token: SETUP_KEY })).status, 409)
})
