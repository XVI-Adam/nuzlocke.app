// Per-run storage of the last *accepted* save snapshot, which later syncs are
// compared against. Kept under its own localStorage key, separate from the
// run's tracker data, so accepting a snapshot never changes the tracker.
import { IDS } from '$lib/store'

const key = (runId) => `${IDS.game(runId)}.unbound`

export const readBaseline = (runId) => {
  if (!runId) return null
  try {
    return JSON.parse(localStorage.getItem(key(runId)))?.baseline || null
  } catch (e) {
    console.error('Could not read Unbound baseline', e)
    return null
  }
}

/** @param source 'upload' | 'dropbox' */
export const acceptBaseline = (runId, snapshot, source) => {
  const baseline = { snapshot, source, acceptedAt: Date.now() }
  localStorage.setItem(key(runId), JSON.stringify({ baseline }))
  return baseline
}
