// Level caps from save progress. Pure module; relative imports only so it
// runs in both the browser (Vite) and Node (tests).
import CAPS from '../data/unbound/level-caps.data.js'

// Value stored in snapshots when there is no cap (keeps the snapshot shape
// numeric, as it has been since Phase 1)
export const UNCAPPED = 100

// Both app difficulties (unbound = Difficult, unbound_exp = Expert) use the
// "Difficult and higher" table
export const capTableFor = () => CAPS.difficult

/**
 * @param progress { badges | badgeCount, champion | isChampion }
 * @returns {{ cap: number|null, upTo: number|null, milestone: object|null, champion: boolean, badges: number }}
 *   cap       the cap that certainly applies (null when uncapped)
 *   upTo      the higher cap once `milestone` is reached (null if none pending)
 */
export function levelCapFor(progress = {}) {
  const table = capTableFor()
  const champion = !!(progress.champion ?? progress.isChampion)
  const raw = Number(progress.badges ?? progress.badgeCount) || 0
  const badges = Math.min(Math.max(0, Math.floor(raw)), table.byBadges.length - 1)

  if (champion) return { cap: null, upTo: null, milestone: null, champion, badges }

  const milestone = table.milestones.find((m) => m.afterBadges === badges) || null
  return {
    cap: table.byBadges[badges],
    upTo: milestone ? milestone.cap : null,
    milestone,
    champion,
    badges
  }
}

/** The number stored in snapshot.progress.levelCap (uses the certain cap) */
export const snapshotCap = (progress) => levelCapFor(progress).cap ?? UNCAPPED

/**
 * Party mons above the cap. `over` is certain; `maybeOver` sit between the
 * certain cap and the milestone cap, so they're only over if the milestone
 * hasn't been reached.
 */
export function overCap(mons = [], info) {
  if (!info || info.cap == null) return { over: [], maybeOver: [] }
  const top = info.upTo ?? info.cap
  return {
    over: mons.filter((m) => m.level > top),
    maybeOver: mons.filter((m) => m.level > info.cap && m.level <= top)
  }
}

/** Short label, e.g. "40 (45 after Tarmigan Mansion)" or "None (Champion)" */
export function capLabel(info) {
  if (!info) return ''
  if (info.cap == null) return 'None (Champion)'
  return info.upTo ? `${info.cap} (${info.upTo} after ${info.milestone.label})` : String(info.cap)
}
