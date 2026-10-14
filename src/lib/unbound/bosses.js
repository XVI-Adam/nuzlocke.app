// Attaches each Unbound boss's wiki check (data/unbound/bosses.verification.data.js,
// written by tools/verify-unbound-bosses.mjs) to the routes served to the
// tracker. Pure module; relative imports only. Boss teams themselves are
// never changed here.
import CHECKS from '../data/unbound/bosses.verification.data.js'

export const WIKI_URL = CHECKS.source

/** { status, wikiDifficulty, diffs?, levelScaled?, url } for one boss key, or null */
export function bossCheckFor(value, checks = CHECKS) {
  const c = checks.bosses[value]
  if (!c || c.status === 'post-game' || c.status === 'missing-in-app') return null
  return {
    status: c.status,
    wikiDifficulty: c.wikiDifficulty,
    ...(c.diffs ? { diffs: c.diffs } : {}),
    ...(c.levelScaled ? { levelScaled: true } : {}),
    url: `${checks.source}/wiki/${encodeURIComponent(c.page.replace(/ /g, '_'))}`,
    revid: c.revid
  }
}

export function withBossChecks(routes, checks = CHECKS) {
  return routes.map((r) => {
    if (r.type !== 'gym') return r
    const bossCheck = bossCheckFor(r.value, checks)
    return bossCheck ? { ...r, bossCheck } : r
  })
}
