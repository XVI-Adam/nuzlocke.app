// Compares two save snapshots (from parse.js) and describes what changed.
// Purely informational: nothing here writes tracker data. In particular a mon
// entering the graveyard box is reported as a *possible* death only.
import { describeSpecies } from './species.js'

// Names come from the species id, not the stored name, so snapshots saved by
// older schema versions (e.g. "Gyarados (Form 1)") display consistently
const speciesLabel = (m) => describeSpecies(m.species.id).label

export const DEFAULT_GRAVEYARD_BOX = 24

export const DIFF_STATUS = {
  NO_BASELINE: 'no-baseline', // nothing to compare against yet
  DIFFERENT_TRAINER: 'different-trainer', // new game / new attempt
  OLDER_SAVE: 'older-save', // snapshot predates the baseline
  SAME_SAVE: 'same-save', // identical save index
  CHANGED: 'changed'
}

// True if save index `a` is newer than `b` (indices wrap at 2^32)
const isNewer = (a, b) => {
  const delta = (a - b) >>> 0
  return delta > 0 && delta < 0x80000000
}

const sameTrainer = (a, b) => a.trainer.id === b.trainer.id && a.trainer.secretId === b.trainer.secretId

export const locationOf = (mon) => (mon.box ? `box ${mon.box}` : 'party')

const withLocation = (snapshot) => [
  ...snapshot.party.map((m) => ({ ...m, location: 'party' })),
  ...snapshot.boxes.flatMap((b) => b.mons.map((m) => ({ ...m, location: `box ${b.box}` })))
]

const brief = (m) => ({
  pid: m.pid,
  nickname: m.nickname,
  speciesId: m.species.id,
  species: speciesLabel(m),
  level: m.level,
  location: m.location
})

const range = (from, to) => ({ from, to, changed: from !== to })

/**
 * @param prev  last accepted snapshot, or null
 * @param next  newly parsed snapshot
 * @param opts.graveyardBox  PC box the player uses for fainted mons
 */
export function diffSnapshots(prev, next, { graveyardBox = DEFAULT_GRAVEYARD_BOX } = {}) {
  if (!prev) return { status: DIFF_STATUS.NO_BASELINE }
  if (!sameTrainer(prev, next)) return { status: DIFF_STATUS.DIFFERENT_TRAINER }
  if (prev.game.saveIndex === next.game.saveIndex) return { status: DIFF_STATUS.SAME_SAVE }
  if (!isNewer(next.game.saveIndex, prev.game.saveIndex)) return { status: DIFF_STATUS.OLDER_SAVE }

  const graveyard = `box ${graveyardBox}`
  const before = new Map(withLocation(prev).map((m) => [m.pid, m]))
  const after = new Map(withLocation(next).map((m) => [m.pid, m]))

  const caught = []
  const evolved = []
  const leveled = []
  const moved = []
  const enteredGraveyard = []
  const leftGraveyard = []

  for (const [pid, m] of after) {
    const old = before.get(pid)
    if (!old) {
      caught.push(brief(m))
      if (m.location === graveyard) enteredGraveyard.push(brief(m))
      continue
    }
    if (old.species.id !== m.species.id)
      evolved.push({ ...brief(m), from: speciesLabel(old), to: speciesLabel(m) })
    if (old.level !== m.level) leveled.push({ ...brief(m), from: old.level, to: m.level })
    if (old.location !== m.location) {
      moved.push({ ...brief(m), from: old.location, to: m.location })
      if (m.location === graveyard) enteredGraveyard.push(brief(m))
      if (old.location === graveyard) leftGraveyard.push(brief(m))
    }
  }

  // Gone from both party and PC: released, traded away, or otherwise lost
  const missing = [...before.values()].filter((m) => !after.has(m.pid)).map(brief)

  const fainted = next.party.filter((m) => m.hp.current === 0).map((m) => brief({ ...m, location: 'party' }))

  return {
    status: DIFF_STATUS.CHANGED,
    saveIndex: range(prev.game.saveIndex, next.game.saveIndex),
    badges: range(prev.progress.badges, next.progress.badges),
    levelCap: range(prev.progress.levelCap.normal, next.progress.levelCap.normal),
    champion: range(prev.progress.champion, next.progress.champion),
    playtime: { from: prev.playtime, to: next.playtime },
    caught,
    evolved,
    leveled,
    moved,
    missing,
    fainted,
    // Possible deaths: shown for the player to confirm, never applied automatically
    enteredGraveyard,
    leftGraveyard
  }
}
