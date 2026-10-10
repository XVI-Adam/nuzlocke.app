// POST /api/unbound/save - returns the latest Unbound .sav from the configured
// Dropbox shared link. Requires `Authorization: Bearer <UNBOUND_SYNC_KEY>`.
// See $lib/unbound/server/save-endpoint.js for the security model.
import { env } from '$env/dynamic/private'
import { createSaveHandler } from '$lib/unbound/server/save-endpoint'

export const POST = createSaveHandler(() => env)
