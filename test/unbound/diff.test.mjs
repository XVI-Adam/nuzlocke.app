import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { diffSnapshots, DIFF_STATUS } from '../../src/lib/unbound/diff.js'
import { parseUnboundSave } from '../../src/lib/unbound/parse.js'

// ---- Synthetic snapshots ---------------------------------------------------

// Real Unbound species ids, so names resolve through the species table
const ID = {
  Rattata: 19, Pidgey: 16, Zubat: 41, Gastly: 92, Haunter: 93, Eevee: 133, Vaporeon: 134,
  Phanpy: 231, Larvitar: 246, Pupitar: 247, Sandshrew: 27, 'Alolan Sandshrew': 1023, Gyarados: 130
}
const mon = (pid, species, level, extra = {}) => ({
  pid,
  nickname: `Mon${pid}`,
  species: { id: ID[species], name: species },
  level,
  hp: { current: 10, max: 10 },
  ...extra
})

const snapshot = ({ saveIndex = 10, trainer = { id: 1, secretId: 2 }, badges = 0, party = [], boxes = {} } = {}) => ({
  game: { saveIndex },
  trainer,
  playtime: { hours: 1, minutes: 0, seconds: 0 },
  progress: { badges, champion: false, levelCap: { normal: 20 + badges } },
  party,
  boxes: Array.from({ length: 25 }, (_, i) => ({
    box: i + 1,
    mons: (boxes[i + 1] || []).map((m, s) => ({ ...m, box: i + 1, slot: s + 1 }))
  }))
})

test('reports when there is nothing to compare', () => {
  assert.equal(diffSnapshots(null, snapshot()).status, DIFF_STATUS.NO_BASELINE)
})

test('refuses to diff saves from a different trainer (new game)', () => {
  const d = diffSnapshots(snapshot(), snapshot({ saveIndex: 11, trainer: { id: 9, secretId: 2 } }))
  assert.equal(d.status, DIFF_STATUS.DIFFERENT_TRAINER)
})

test('detects identical and older saves', () => {
  assert.equal(diffSnapshots(snapshot(), snapshot()).status, DIFF_STATUS.SAME_SAVE)
  assert.equal(diffSnapshots(snapshot({ saveIndex: 10 }), snapshot({ saveIndex: 9 })).status, DIFF_STATUS.OLDER_SAVE)
  // Save index wraparound counts as newer
  assert.equal(
    diffSnapshots(snapshot({ saveIndex: 0xffffffff }), snapshot({ saveIndex: 0 })).status,
    DIFF_STATUS.CHANGED
  )
})

test('describes catches, evolutions, level-ups, moves and losses', () => {
  const prev = snapshot({
    party: [mon(1, 'Gastly', 20), mon(2, 'Larvitar', 25)],
    boxes: { 1: [mon(3, 'Zubat', 10), mon(4, 'Rattata', 5)] }
  })
  const next = snapshot({
    saveIndex: 12,
    badges: 1,
    party: [mon(1, 'Haunter', 25), mon(5, 'Phanpy', 12)],
    boxes: { 1: [mon(3, 'Zubat', 10)], 24: [mon(2, 'Pupitar', 30)] }
  })
  const d = diffSnapshots(prev, next)

  assert.equal(d.status, DIFF_STATUS.CHANGED)
  assert.deepEqual(d.saveIndex, { from: 10, to: 12, changed: true })
  assert.deepEqual(d.badges, { from: 0, to: 1, changed: true })
  assert.deepEqual(d.caught.map((m) => m.species), ['Phanpy'])
  assert.deepEqual(d.evolved.map((m) => [m.from, m.to]), [['Gastly', 'Haunter'], ['Larvitar', 'Pupitar']])
  assert.deepEqual(d.leveled.map((m) => [m.pid, m.from, m.to]), [[1, 20, 25], [2, 25, 30]])
  assert.deepEqual(d.moved.map((m) => [m.pid, m.from, m.to]), [[2, 'party', 'box 24']])
  assert.deepEqual(d.missing.map((m) => m.species), ['Rattata'])
  assert.deepEqual(d.enteredGraveyard.map((m) => m.pid), [2])
  assert.deepEqual(d.leftGraveyard, [])
})

test('graveyard box is configurable and new catches placed there count', () => {
  const prev = snapshot({ party: [mon(1, 'Eevee', 10)] })
  const next = snapshot({ saveIndex: 11, boxes: { 3: [mon(1, 'Eevee', 10), mon(2, 'Pidgey', 3)] } })
  assert.deepEqual(diffSnapshots(prev, next).enteredGraveyard, [])
  assert.deepEqual(diffSnapshots(prev, next, { graveyardBox: 3 }).enteredGraveyard.map((m) => m.pid), [1, 2])
})

test('a mon taken back out of the graveyard is reported', () => {
  const prev = snapshot({ boxes: { 24: [mon(1, 'Eevee', 10)] } })
  const next = snapshot({ saveIndex: 11, party: [mon(1, 'Eevee', 10)] })
  assert.deepEqual(diffSnapshots(prev, next).leftGraveyard.map((m) => m.pid), [1])
})

test('lists fainted party members', () => {
  const next = snapshot({ saveIndex: 11, party: [mon(1, 'Eevee', 10, { hp: { current: 0, max: 30 } })] })
  assert.deepEqual(diffSnapshots(snapshot(), next).fainted.map((m) => m.pid), [1])
})

test('names come from the species id, so old baselines show corrected names', () => {
  // A schema-1 baseline stored PUSE's positional label
  const legacy = snapshot({ party: [{ ...mon(1, 'Gyarados', 30), species: { id: 130, name: 'Gyarados (Form 1)' } }] })
  const next = snapshot({ saveIndex: 11, party: [mon(1, 'Gyarados', 31), mon(2, 'Alolan Sandshrew', 12)] })
  const d = diffSnapshots(legacy, next)
  assert.deepEqual(d.leveled.map((m) => m.species), ['Gyarados'])
  assert.deepEqual(d.caught.map((m) => [m.species, m.speciesId]), [['Alolan Sandshrew', 1023]])
})

test('does not mutate its inputs', () => {
  const prev = snapshot({ party: [mon(1, 'Eevee', 10)] })
  const next = snapshot({ saveIndex: 11, party: [mon(1, 'Vaporeon', 20)] })
  const copies = JSON.stringify([prev, next])
  diffSnapshots(prev, next)
  assert.equal(JSON.stringify([prev, next]), copies)
})

// ---- Real saves (skipped when fixtures are absent) ---------------------------

const FIXTURES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../fixtures/unbound')
const saves = fs.existsSync(FIXTURES) ? fs.readdirSync(FIXTURES).filter((f) => f.endsWith('.sav')).sort() : []
const expectedFile = path.join(FIXTURES, 'expected.json')
const transitions = fs.existsSync(expectedFile)
  ? JSON.parse(fs.readFileSync(expectedFile, 'utf8')).transitions || {}
  : {}

test(
  'diff of consecutive fixture saves matches recorded transitions',
  { skip: (saves.length < 2 || !Object.keys(transitions).length) && 'needs two fixture saves and expected.json transitions' },
  () => {
    for (let i = 1; i < saves.length; i++) {
      const want = transitions[`${saves[i - 1]}->${saves[i]}`]
      if (!want) continue
      const read = (f) => parseUnboundSave(fs.readFileSync(path.join(FIXTURES, f)))
      const d = diffSnapshots(read(saves[i - 1]), read(saves[i]))
      const names = (list) => list.map((m) => m.nickname)
      assert.deepEqual(
        {
          caught: names(d.caught),
          evolved: d.evolved.map((m) => `${m.nickname}: ${m.from} -> ${m.to}`),
          enteredGraveyard: names(d.enteredGraveyard),
          missing: names(d.missing),
          badges: [d.badges.from, d.badges.to]
        },
        want
      )
    }
  }
)
