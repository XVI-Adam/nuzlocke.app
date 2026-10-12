// Two-or-more device sync tests: each device is a MemoryStorage; the server
// is the real request handler on an in-memory store, called through a fake
// `fetch` that can be switched offline or made to fail.
import { createSyncHandler } from '../../src/lib/sync/server/handlers.js'
import { createMemoryStore } from '../../src/lib/sync/server/store-memory.js'
import { beginConnect, completeConnect, previewConnect, contextFor } from '../../src/lib/sync/device.js'
import { syncCycle } from '../../src/lib/sync/engine.js'
import { loadState } from '../../src/lib/sync/state.js'

export { MemoryStorage, seeded, tracker, side, snapshot, run, RUN, NEW_RUN, OTHER_RUN, OT } from '../history/helpers.mjs'

export const SETUP_KEY = 'test-setup-key-0123456789-abcdefghijklmnop'
export const SAVE_KEY = 'test-unbound-key-0123456789-abcdefghijklmnop'

export function createServer({ now = () => Date.now(), env = {}, store = createMemoryStore({ now }) } = {}) {
  const logs = []
  const requests = []
  const handler = createSyncHandler({
    getEnv: () => ({ SYNC_SETUP_KEY: SETUP_KEY, UNBOUND_SYNC_KEY: SAVE_KEY, ...env }),
    getStore: () => store,
    log: (m) => logs.push(m),
    now
  })
  // dropResponseNext: push replies to lose after the server applied them
  const net = { offline: false, failNext: 0, failOp: null, dropResponseNext: 0, address: '203.0.113.7' }

  const fetch = async (url, init = {}) => {
    if (net.offline) throw new TypeError('fetch failed')
    const op = url.split('/').pop()
    if (net.failNext > 0 && (!net.failOp || net.failOp === op)) {
      net.failNext--
      return new Response(JSON.stringify({ error: 'storage-error' }), { status: 503, headers: { 'content-type': 'application/json' } })
    }
    requests.push({ url, headers: { ...init.headers }, body: init.body })
    const res = await handler({
      request: new Request(`https://nuzlocke.test${url}`, init),
      params: { op },
      getClientAddress: () => net.address
    })
    if (op === 'push' && net.dropResponseNext > 0) {
      net.dropResponseNext--
      throw new TypeError('network connection was lost')
    }
    return res
  }
  return { store, handler, fetch, net, logs, requests }
}

let counter = 0
export const ids = () => {
  counter++
  return `ffffffff-0000-4000-8000-${String(counter).padStart(12, '0')}`
}

/** A device bound to the fake server */
export function device(server, storage) {
  const opts = { fetch: server.fetch }
  return {
    storage,
    opts,
    async connectNew(name = 'Computer') {
      await beginConnect(storage, { method: 'setup', setupKey: SETUP_KEY, name }, opts)
      const preview = await previewConnect(storage, opts)
      await completeConnect(storage, {}, opts)
      return preview
    },
    async sync(extra = {}) {
      const ctx = await contextFor(storage, opts)
      ctx.newId = ids
      return syncCycle(ctx, extra)
    },
    state: () => loadState(storage)
  }
}
