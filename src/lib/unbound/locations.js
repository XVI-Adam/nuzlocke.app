// Save met-location id -> existing route key. Pure module; relative imports
// only so it runs in both the browser (Vite) and Node (tests).
import LOCATIONS from '../data/unbound/locations.data.js'

/**
 * @param id  met location id from the save (mon.met.locationId)
 * @returns {{ id, key: string|null, label: string, known: boolean, confirmed: boolean }}
 *   key is an existing routes.json route key, or null when the id is unmapped
 */
export function locationFor(id, table = LOCATIONS) {
  const n = Number(id)
  const hit = Number.isInteger(n) ? table[n] : null
  if (!hit) return { id: n, key: null, label: `Unknown location #${Number.isInteger(n) ? n : '?'}`, known: false, confirmed: false }
  return { id: n, key: hit.key, label: hit.key, known: true, confirmed: !!hit.confirmed }
}

/** "Route 1" / "Route 1?" (unconfirmed) / "Unknown location #12" */
export const metLabel = (mon) => {
  if (!mon?.met) return ''
  const loc = locationFor(mon.met.locationId)
  return loc.known && !loc.confirmed ? `${loc.label}?` : loc.label
}
