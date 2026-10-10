import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  createSaveHandler,
  fetchSave,
  isAuthorized,
  parseShareLink,
  MAX_SAVE_BYTES
} from '../../src/lib/unbound/server/save-endpoint.js'

// Obviously fake values; no real link or key is used in tests
const KEY = 'k'.repeat(40)
const LINK = 'https://www.dropbox.com/scl/fi/abc123/GameSave-test?rlkey=secretrlkey&st=x&dl=0'
const SAVE = new Uint8Array(0x20000).fill(7)

const ok = (body = SAVE, headers = {}) =>
  new Response(body, { status: 200, headers: { 'content-type': 'application/octet-stream', ...headers } })
const redirect = (location) => new Response(null, { status: 302, headers: { location } })

// Fake fetch: returns responses in order and records requested URLs
const fakeFetch = (...responses) => {
  const calls = []
  const fn = async (url, init) => {
    calls.push({ url: String(url), init })
    const next = responses.shift()
    if (next instanceof Error) throw next
    return typeof next === 'function' ? next(url, init) : next
  }
  fn.calls = calls
  return fn
}

const request = (headers = {}) => ({ request: new Request('http://localhost/api/unbound/save', { method: 'POST', headers }) })
const auth = { authorization: `Bearer ${KEY}` }
const handler = (env, fetch, logs = []) =>
  createSaveHandler(() => env, { fetch, log: (m) => logs.push(m) })
const ENV = { UNBOUND_SYNC_KEY: KEY, UNBOUND_SAVE_URL: LINK }

// ---- Authorisation -----------------------------------------------------------

test('isAuthorized requires an exact bearer key of sufficient length', () => {
  assert.equal(isAuthorized(`Bearer ${KEY}`, KEY), true)
  assert.equal(isAuthorized(undefined, KEY), false)
  assert.equal(isAuthorized('', KEY), false)
  assert.equal(isAuthorized(KEY, KEY), false) // missing scheme
  assert.equal(isAuthorized(`Basic ${KEY}`, KEY), false)
  assert.equal(isAuthorized(`Bearer ${KEY}x`, KEY), false)
  assert.equal(isAuthorized(`Bearer ${KEY.slice(1)}`, KEY), false)
  assert.equal(isAuthorized('Bearer short', 'short'), false) // configured key too short
})

test('endpoint fails closed when not configured', async () => {
  const fetch = fakeFetch()
  for (const env of [{}, { UNBOUND_SAVE_URL: LINK }, { UNBOUND_SYNC_KEY: KEY }, { ...ENV, UNBOUND_SYNC_KEY: 'too-short' }]) {
    const res = await handler(env, fetch)(request(auth))
    assert.equal(res.status, 503)
  }
  assert.equal(fetch.calls.length, 0)
})

test('endpoint rejects missing or wrong keys without contacting Dropbox', async () => {
  const fetch = fakeFetch()
  for (const headers of [{}, { authorization: 'Bearer nope' }, { authorization: KEY }]) {
    const res = await handler(ENV, fetch)(request(headers))
    assert.equal(res.status, 401)
    assert.deepEqual(await res.json(), { error: 'unauthorized' })
  }
  assert.equal(fetch.calls.length, 0)
})

// ---- Happy path ----------------------------------------------------------------

test('authorised request returns the save bytes, uncached', async () => {
  const fetch = fakeFetch(redirect('https://uc123.dl.dropboxusercontent.com/cd/0/get/x'), ok())
  const res = await handler(ENV, fetch)(request(auth))

  assert.equal(res.status, 200)
  assert.equal(res.headers.get('content-type'), 'application/octet-stream')
  assert.equal(res.headers.get('cache-control'), 'no-store')
  assert.deepEqual(new Uint8Array(await res.arrayBuffer()), SAVE)

  // Only the configured link, forced to dl=1, then the Dropbox redirect
  const first = new URL(fetch.calls[0].url)
  assert.equal(first.hostname, 'www.dropbox.com')
  assert.equal(first.searchParams.get('dl'), '1')
  assert.equal(fetch.calls[0].init.redirect, 'manual')
  assert.equal(new URL(fetch.calls[1].url).hostname, 'uc123.dl.dropboxusercontent.com')
})

test('request contents cannot change what is fetched', async () => {
  const fetch = fakeFetch(ok())
  const req = new Request('http://localhost/api/unbound/save?url=https://evil.example/', {
    method: 'POST',
    headers: { ...auth, 'x-forwarded-host': 'evil.example', 'content-type': 'application/json' },
    body: JSON.stringify({ url: 'https://evil.example/' })
  })
  await handler(ENV, fetch)({ request: req })
  assert.equal(fetch.calls.length, 1)
  assert.equal(new URL(fetch.calls[0].url).hostname, 'www.dropbox.com')
})

// ---- Never leaks the link ---------------------------------------------------------

test('errors and logs never contain the shared link', async () => {
  const cases = [
    [new TypeError(`fetch failed for ${LINK}`)],
    [new Response('gone', { status: 404 })],
    [new Response('<html>', { status: 200, headers: { 'content-type': 'text/html' } })],
    [redirect('https://evil.example/steal')],
    [ok(new Uint8Array(100))]
  ]
  for (const responses of cases) {
    const logs = []
    const res = await handler(ENV, fakeFetch(...responses), logs)(request(auth))
    const body = await res.text()
    assert.ok(res.status >= 500, body)
    for (const text of [body, ...logs]) {
      assert.ok(!text.includes('dropbox.com'), text)
      assert.ok(!text.includes('secretrlkey'), text)
      assert.ok(!text.includes('abc123'), text)
    }
  }
})

test('misconfigured links are refused without fetching', async () => {
  const fetch = fakeFetch()
  for (const UNBOUND_SAVE_URL of [
    'not a url',
    'http://www.dropbox.com/scl/fi/abc/x?dl=1', // not https
    'https://evil.example/scl/fi/abc/x',
    'https://www.dropbox.com.evil.example/scl/fi/abc/x',
    'https://www.dropbox.com/home/private', // not a shared-file link
    'https://dl.dropboxusercontent.com/s/abc/x' // direct host not accepted as config
  ]) {
    const res = await handler({ ...ENV, UNBOUND_SAVE_URL }, fetch)(request(auth))
    assert.equal(res.status, 503, UNBOUND_SAVE_URL)
    assert.deepEqual(await res.json(), { error: 'misconfigured' })
  }
  assert.equal(fetch.calls.length, 0)
})

// ---- Not an open proxy: redirects ------------------------------------------------------

test('only HTTPS redirects to Dropbox hosts are followed', async () => {
  const link = parseShareLink(LINK)
  const rejects = (location) =>
    assert.rejects(fetchSave(link, { fetch: fakeFetch(redirect(location), ok()) }), { code: 'bad-redirect' })

  await rejects('https://evil.example/x')
  await rejects('https://dl.dropboxusercontent.com.evil.example/x')
  await rejects('https://evildropboxusercontent.com/x')
  await rejects('http://uc1.dl.dropboxusercontent.com/x')
  await rejects('file:///etc/passwd')
  await rejects('http://169.254.169.254/latest/meta-data')

  const bytes = await fetchSave(link, { fetch: fakeFetch(redirect('/scl/fi/abc123/other?dl=1'), ok()) })
  assert.equal(bytes.byteLength, SAVE.byteLength) // relative redirect on same host is fine
})

test('redirect loops are cut off', async () => {
  const loop = () => redirect('https://www.dropbox.com/scl/fi/abc123/x?dl=1')
  await assert.rejects(
    fetchSave(parseShareLink(LINK), { fetch: fakeFetch(loop, loop, loop, loop, loop, ok()) }),
    { code: 'too-many-redirects' }
  )
})

// ---- Size, type and time limits ------------------------------------------------------

test('oversized responses are refused, declared or streamed', { timeout: 5000 }, async () => {
  const link = parseShareLink(LINK)
  await assert.rejects(
    fetchSave(link, { fetch: fakeFetch(ok(new Uint8Array(10), { 'content-length': String(MAX_SAVE_BYTES + 1) })) }),
    { code: 'too-large' }
  )
  // Finite but over the cap, with no content-length: must still be refused
  let chunks = MAX_SAVE_BYTES / 0x10000 + 2
  const oversized = new ReadableStream({
    pull(c) {
      if (chunks-- > 0) c.enqueue(new Uint8Array(0x10000))
      else c.close()
    }
  })
  await assert.rejects(fetchSave(link, { fetch: fakeFetch(ok(oversized)) }), { code: 'too-large' })
})

test('HTML pages and tiny files are not treated as saves', async () => {
  const link = parseShareLink(LINK)
  await assert.rejects(
    fetchSave(link, { fetch: fakeFetch(new Response('<html>', { headers: { 'content-type': 'text/html; charset=utf-8' } })) }),
    { code: 'not-a-file' }
  )
  await assert.rejects(fetchSave(link, { fetch: fakeFetch(ok(new Uint8Array(512))) }), { code: 'too-small' })
})

test('slow upstreams time out', async () => {
  const hang = (_url, { signal }) =>
    new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason)))
  await assert.rejects(fetchSave(parseShareLink(LINK), { fetch: fakeFetch(hang), timeoutMs: 50 }), { code: 'timeout' })
})
