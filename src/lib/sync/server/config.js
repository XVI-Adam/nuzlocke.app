// Picks the sync storage from the environment. Upstash Redis (Vercel
// Marketplace) sets KV_REST_API_URL / KV_REST_API_TOKEN, or
// UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN. Without them, `vite dev`
// uses an in-memory store and production reports "not configured".
import { createRedisStore, createUpstashSend } from './store-redis.js'
import { createMemoryStore } from './store-memory.js'

let cached = null

export function storeFromEnv(env, { dev = false } = {}) {
  const url = env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL
  const token = env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN
  if (url && token) {
    if (!/^https:\/\//.test(url)) return null
    const id = `redis:${url}`
    if (cached?.id !== id) cached = { id, store: createRedisStore(createUpstashSend({ url, token })) }
    return cached.store
  }
  if (!dev) return null
  // Survives dev-server module reloads
  globalThis.__nuzlockeSyncMemoryStore ||= createMemoryStore()
  return globalThis.__nuzlockeSyncMemoryStore
}
