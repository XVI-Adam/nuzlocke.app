// Save-aware progress hints for an Unbound run. Pure module.
//
// Only reads: badges/champion from the accepted save, the route list, and
// the bosses the player has recorded as defeated (__teams). Nothing here
// marks a boss defeated or changes an encounter - the results are
// navigation hints.

const isBoss = (r) => r.type === 'gym'
const gymNumber = (r) => (r.group === 'gym-leader' ? Number(String(r.value).replace(/_exp$/, '')) : null)
const isChampion = (r) => String(r.value).replace(/_exp$/, '') === 'c'

/**
 * Bosses between the player's last badge and the next badge (or the
 * Champion after 8 badges), skipping any the player recorded as defeated.
 *
 * @param routes   the run's route list (routes.json order)
 * @param progress { badges, champion } from the accepted save
 * @param defeated boss values the player recorded as defeated
 * @returns {{ next: route|null, upcoming: route[], goal: route|null }}
 *   next: the first such boss; upcoming: all of them up to and including
 *   goal (the next gym leader, or the Champion)
 */
export function nextBosses(routes = [], progress = {}, defeated = []) {
  const empty = { next: null, upcoming: [], goal: null }
  if (progress.champion) return empty
  const badges = Math.max(0, Math.min(8, Number(progress.badges) || 0))
  const done = new Set(defeated)

  const lastGym = badges ? routes.findIndex((r) => isBoss(r) && gymNumber(r) === badges) : -1
  if (badges && lastGym < 0) return empty
  const goalIndex = routes.findIndex(
    (r, i) => i > lastGym && isBoss(r) && (badges < 8 ? gymNumber(r) === badges + 1 : isChampion(r))
  )
  if (goalIndex < 0) return empty

  const upcoming = routes.slice(lastGym + 1, goalIndex + 1).filter((r) => isBoss(r) && !done.has(r.value))
  return { next: upcoming[0] || null, upcoming, goal: routes[goalIndex] }
}

/** Index in `routes` to continue from: just after the last badge's gym (or 0) */
export function savePosition(routes = [], progress = {}) {
  const badges = Math.max(0, Math.min(8, Number(progress.badges) || 0))
  if (progress.champion) {
    const c = routes.findIndex((r) => isBoss(r) && isChampion(r))
    return c < 0 ? 0 : c + 1
  }
  if (!badges) return 0
  const gym = routes.findIndex((r) => isBoss(r) && gymNumber(r) === badges)
  return gym < 0 ? 0 : gym + 1
}

// Unbound starters and the app's rival-team key for each (the player's
// starter choice; see components/starter-type.svelte)
const STARTER_KEYS = { gible: 'fire', beldum: 'water', larvitar: 'grass' }

/**
 * The player's starter as the app's rival key ('fire' | 'water' | 'grass'),
 * from the save mon the player linked to the tracker's Starter record.
 * Returns null unless exactly that link exists - never guessed.
 *
 * @param snapshot accepted save; side links { "otId:pid": recordKey }
 * @param evolineOf alias -> evolution line base alias (tracker data)
 * @param aliasOf species id -> tracker alias
 */
export function starterFromSave(snapshot, links = {}, { evolineOf, aliasOf }) {
  const identity = Object.keys(links).find((id) => links[id] === 'Starter')
  if (!identity || !snapshot) return null
  const mons = [...(snapshot.party || []), ...(snapshot.boxes || []).flatMap((b) => b.mons || [])]
  const mon = mons.find((m) => `${m.otId}:${m.pid}` === identity)
  const alias = mon && aliasOf(mon.species.id)
  if (!alias) return null
  return STARTER_KEYS[evolineOf(alias)] || null
}
