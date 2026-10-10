// Server-only: fetches the player's Unbound save from a Dropbox shared link
// configured in the environment, for an authorised caller.
//
// Security model
// - Caller must send `Authorization: Bearer <UNBOUND_SYNC_KEY>`. The key is
//   compared in constant time; a missing or short (<32 char) key disables
//   the endpoint entirely (fail closed).
// - Not a proxy: the only URL ever fetched comes from UNBOUND_SAVE_URL, and it
//   (and every redirect) must be HTTPS on a Dropbox host. Nothing from the
//   request influences what is fetched.
// - The shared link is never returned, logged or included in errors.
// - Responses are capped in size and never cached.
import { createHash, timingSafeEqual } from 'node:crypto'

export const MIN_KEY_LENGTH = 32
export const MIN_SAVE_BYTES = 0x10000
export const MAX_SAVE_BYTES = 0x40000
const MAX_REDIRECTS = 3
const TIMEOUT_MS = 10_000

const SHARE_HOSTS = new Set(['www.dropbox.com', 'dropbox.com'])
const isDropboxHost = (host) =>
  SHARE_HOSTS.has(host) || host === 'dl.dropboxusercontent.com' || host.endsWith('.dl.dropboxusercontent.com')

export class SaveFetchError extends Error {
  constructor(code) {
    super(code)
    this.code = code
  }
}

const sha256 = (s) => createHash('sha256').update(String(s)).digest()

/** Constant-time check of an Authorization header against the configured key */
export function isAuthorized(header, key) {
  if (typeof key !== 'string' || key.length < MIN_KEY_LENGTH) return false
  const match = /^Bearer (.+)$/.exec(header || '')
  if (!match) return false
  return timingSafeEqual(sha256(match[1]), sha256(key))
}

/** Validates the configured shared link and forces a direct download */
export function parseShareLink(raw) {
  let url
  try {
    url = new URL(raw)
  } catch {
    throw new SaveFetchError('misconfigured')
  }
  if (url.protocol !== 'https:' || !SHARE_HOSTS.has(url.hostname)) throw new SaveFetchError('misconfigured')
  if (!/^\/(scl\/fi|s)\//.test(url.pathname)) throw new SaveFetchError('misconfigured')
  url.username = url.password = ''
  url.hash = ''
  url.searchParams.set('dl', '1')
  return url
}

const readCapped = async (res) => {
  const declared = Number(res.headers.get('content-length'))
  if (declared > MAX_SAVE_BYTES) throw new SaveFetchError('too-large')

  const reader = res.body.getReader()
  const chunks = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > MAX_SAVE_BYTES) {
      await reader.cancel()
      throw new SaveFetchError('too-large')
    }
    chunks.push(value)
  }
  const out = new Uint8Array(size)
  let offset = 0
  for (const c of chunks) {
    out.set(c, offset)
    offset += c.byteLength
  }
  return out
}

/** Downloads the save, following only HTTPS redirects between Dropbox hosts */
export async function fetchSave(shareUrl, { fetch = globalThis.fetch, timeoutMs = TIMEOUT_MS } = {}) {
  const signal = AbortSignal.timeout(timeoutMs)
  let url = shareUrl

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    let res
    try {
      res = await fetch(url, { redirect: 'manual', signal, headers: { accept: 'application/octet-stream' } })
    } catch (e) {
      throw new SaveFetchError(e?.name === 'TimeoutError' || e?.name === 'AbortError' ? 'timeout' : 'upstream-unreachable')
    }

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location')
      let next
      try {
        next = new URL(location, url)
      } catch {
        throw new SaveFetchError('bad-redirect')
      }
      if (next.protocol !== 'https:' || !isDropboxHost(next.hostname)) throw new SaveFetchError('bad-redirect')
      url = next
      continue
    }

    if (res.status === 404 || res.status === 410) throw new SaveFetchError('link-not-found')
    if (!res.ok) throw new SaveFetchError('upstream-error')
    if ((res.headers.get('content-type') || '').includes('text/html')) throw new SaveFetchError('not-a-file')

    const bytes = await readCapped(res)
    if (bytes.byteLength < MIN_SAVE_BYTES) throw new SaveFetchError('too-small')
    return bytes
  }
  throw new SaveFetchError('too-many-redirects')
}

const json = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
  })

const STATUS = {
  misconfigured: 503,
  timeout: 504,
  'link-not-found': 502,
  'upstream-unreachable': 502,
  'upstream-error': 502,
  'bad-redirect': 502,
  'too-many-redirects': 502,
  'not-a-file': 502,
  'too-large': 502,
  'too-small': 502
}

/**
 * Builds the POST handler.
 * @param getEnv () => ({ UNBOUND_SYNC_KEY, UNBOUND_SAVE_URL })
 * @param deps.fetch  injectable for tests
 * @param deps.log    error logger; only ever receives an error code
 */
export function createSaveHandler(getEnv, { fetch = globalThis.fetch, log = console.error } = {}) {
  return async ({ request }) => {
    const { UNBOUND_SYNC_KEY: key, UNBOUND_SAVE_URL: link } = getEnv()

    if (!key || key.length < MIN_KEY_LENGTH || !link) return json(503, { error: 'not-configured' })
    if (!isAuthorized(request.headers.get('authorization'), key)) return json(401, { error: 'unauthorized' })

    try {
      const bytes = await fetchSave(parseShareLink(link), { fetch })
      return new Response(bytes, {
        status: 200,
        headers: {
          'content-type': 'application/octet-stream',
          'content-length': String(bytes.byteLength),
          'cache-control': 'no-store',
          'x-content-type-options': 'nosniff'
        }
      })
    } catch (e) {
      const code = e instanceof SaveFetchError ? e.code : 'internal'
      log(`[unbound-save] ${code}`)
      return json(STATUS[code] || 500, { error: code })
    }
  }
}
