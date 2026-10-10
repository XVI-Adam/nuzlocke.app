// Browser storage for the per-run Unbound side key (see side.js for its
// shape). Kept under its own localStorage key, separate from the run's
// tracker data, and always written merge-safe so baselines, links and facts
// never overwrite each other.
import { IDS } from '$lib/store'
import { normalizeSide } from './side'

export const sideKey = (runId) => `${IDS.game(runId)}.unbound`

export const readSide = (runId) => {
  if (!runId) return normalizeSide(null)
  try {
    return normalizeSide(JSON.parse(localStorage.getItem(sideKey(runId))))
  } catch (e) {
    console.error('Could not read Unbound side data', e)
    return normalizeSide(null)
  }
}

export const writeSide = (runId, side) => localStorage.setItem(sideKey(runId), JSON.stringify(normalizeSide(side)))

export const readBaseline = (runId) => readSide(runId).baseline
