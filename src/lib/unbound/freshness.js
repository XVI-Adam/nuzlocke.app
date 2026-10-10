// How old the last accepted sync is. There is no background polling, so the
// app can't know whether the game has moved on; it can only say how long ago
// the data was captured and flag it once that's long enough to be doubtful.

export const STALE_AFTER_MS = 24 * 60 * 60 * 1000

const UNITS = [
  ['d', 24 * 60 * 60 * 1000],
  ['h', 60 * 60 * 1000],
  ['min', 60 * 1000]
]

/** @returns {{ label: string, stale: boolean }} */
export function syncAge(acceptedAt, now = Date.now()) {
  const age = Math.max(0, now - acceptedAt)
  const stale = age >= STALE_AFTER_MS
  for (const [unit, ms] of UNITS) {
    if (age >= ms) return { label: `${Math.floor(age / ms)} ${unit} ago`, stale }
  }
  return { label: 'just now', stale }
}
