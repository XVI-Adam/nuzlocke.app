// POST /api/sync/{enroll,pair,devices,pull,push,reset} - encrypted
// cross-device sync. See $lib/sync/server/handlers.js for the security model.
import { env } from '$env/dynamic/private'
import { dev } from '$app/environment'
import { createSyncHandler } from '$lib/sync/server/handlers'
import { storeFromEnv } from '$lib/sync/server/config'

export const POST = createSyncHandler({ getEnv: () => env, getStore: () => storeFromEnv(env, { dev }) })
