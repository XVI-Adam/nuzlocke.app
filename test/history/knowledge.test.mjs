import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  readKnowledge,
  writeKnowledge,
  upsert,
  remove,
  forGame,
  findByRef,
  linkedTo,
  noteCount,
  normalizeKnowledge
} from '../../src/lib/history/knowledge.js'
import { archiveAndStartNew, readArchive } from '../../src/lib/history/archive.js'
import { readAttempt, writeAttempt, setChecked } from '../../src/lib/history/attempt.js'
import { MemoryStorage, seeded, RUN, NEW_RUN } from './helpers.mjs'

const B = '10000000-0000-4000-8000-000000000001'
const R = '10000000-0000-4000-8000-000000000002'
const O = '10000000-0000-4000-8000-000000000003'
const L = '10000000-0000-4000-8000-000000000004'
const P = '10000000-0000-4000-8000-000000000005'
const MINI = '10000000-0000-4000-8000-000000000006'

const sample = () => {
  let k = normalizeKnowledge(null)
  k = upsert(k, 'bosses', { id: B, game: 'unbound', ref: 'r1', name: 'Rival Axelrod', strategy: 'Lead with a Water type', prep: [{ id: P, text: 'Stock up on Potions' }] }, 1)
  k = upsert(k, 'bosses', { id: MINI, game: 'unbound', ref: null, name: 'Side-quest miniboss', location: 'Cave basement', mechanics: 'Double battle' }, 1)
  k = upsert(k, 'routes', { id: R, game: 'unbound', ref: 'Route 1', name: 'Route 1', dangers: 'Bug catcher with a fast mon' }, 1)
  k = upsert(k, 'objectives', { id: O, game: 'unbound', name: 'Get the Exp. Share', routeId: R, priority: 'high' }, 1)
  k = upsert(k, 'lessons', { id: L, game: 'unbound', text: 'Do not lead with Boo', bossId: B, pokemon: 'gastly', attemptId: RUN }, 1)
  return k
}

test('route and boss notes survive starting a new attempt', () => {
  const s = seeded()
  writeKnowledge(s, sample())
  const before = s.getItem('nuzlocke.knowledge')
  archiveAndStartNew(s, { runId: RUN, newRunId: NEW_RUN, now: 2 })
  assert.equal(s.getItem('nuzlocke.knowledge'), before)
  const { knowledge } = readKnowledge(s)
  assert.equal(findByRef(knowledge, 'bosses', 'unbound', 'r1').strategy, 'Lead with a Water type')
  assert.equal(linkedTo(knowledge, 'bosses', B).lessons[0].attemptId, RUN, 'lesson still points at the archived attempt')
})

test('custom minibosses exist without routes.json refs, encounter records or __teams', () => {
  const s = seeded()
  const trackerBefore = s.getItem(`nuzlocke.${RUN}`)
  writeKnowledge(s, sample())
  const { knowledge } = readKnowledge(s)
  const mini = knowledge.bosses.find((b) => b.id === MINI)
  assert.equal(mini.ref, null)
  assert.equal(mini.location, 'Cave basement')
  assert.equal(s.getItem(`nuzlocke.${RUN}`), trackerBefore, 'tracker untouched')
})

test('reusable checklist definitions are separate from per-attempt completion', () => {
  const s = seeded()
  writeKnowledge(s, sample())
  writeAttempt(s, RUN, setChecked(readAttempt(s, RUN).attempt, O, true, 3))
  writeAttempt(s, RUN, setChecked(readAttempt(s, RUN).attempt, P, true, 3))
  assert.ok(!s.getItem('nuzlocke.knowledge').includes('"done"'), 'no completion state in knowledge')

  archiveAndStartNew(s, { runId: RUN, newRunId: NEW_RUN, now: 4 })
  assert.equal(readAttempt(s, NEW_RUN).attempt.checklist[O], undefined, 'not complete in the next attempt')
  assert.equal(readAttempt(s, NEW_RUN).attempt.checklist[P], undefined)
  assert.ok(readArchive(s, RUN).data.attempt.checklist[O].done, 'still complete in the archived one')
  assert.equal(readKnowledge(s).knowledge.objectives.length, 1, 'definition persists')
})

test('editing and deleting notes does not touch archived attempts', () => {
  const s = seeded()
  writeKnowledge(s, sample())
  archiveAndStartNew(s, { runId: RUN, newRunId: NEW_RUN, now: 2 })
  const blob = s.getItem(`nuzlocke.archive.${RUN}`)
  const index = s.getItem('nuzlocke.archive')

  let k = readKnowledge(s).knowledge
  k = upsert(k, 'bosses', { id: B, strategy: 'Lead with Grass instead' }, 5)
  k = remove(k, 'bosses', MINI)
  k = remove(k, 'routes', R)
  writeKnowledge(s, k)

  const after = readKnowledge(s).knowledge
  assert.equal(after.bosses.length, 1)
  assert.equal(after.bosses[0].strategy, 'Lead with Grass instead')
  assert.equal(after.bosses[0].name, 'Rival Axelrod', 'other fields kept on edit')
  assert.equal(after.bosses[0].createdAt, 1)
  assert.equal(after.bosses[0].updatedAt, 5)
  assert.equal(after.objectives[0].routeId, null, 'objective kept, unlinked from the deleted route')
  assert.equal(s.getItem(`nuzlocke.archive.${RUN}`), blob)
  assert.equal(s.getItem('nuzlocke.archive'), index)
})

test('malformed stored notes are reported and never overwritten', () => {
  const s = new MemoryStorage({ 'nuzlocke.knowledge': '{oops' })
  const { knowledge, error } = readKnowledge(s)
  assert.ok(error)
  assert.deepEqual(knowledge.bosses, [])
  assert.throws(() => writeKnowledge(s, sample()), /not overwritten/)
  assert.equal(s.getItem('nuzlocke.knowledge'), '{oops')
})

test('malformed entries are dropped, valid ones kept', () => {
  const k = normalizeKnowledge({
    bosses: [{ id: B, name: 'ok', prep: [{ id: 'bad|id', text: 'x' }, { id: P, text: 'y' }, 'junk'] }, { id: 'no good', name: 'bad' }, null, { id: B, name: 'dupe' }],
    lessons: 'not an array'
  })
  assert.deepEqual(k.bosses.map((b) => b.name), ['ok'])
  assert.deepEqual(k.bosses[0].prep, [{ id: P, text: 'y' }])
  assert.deepEqual(k.lessons, [])
})

test('game tags filter entries; untagged entries apply to every game', () => {
  let k = sample()
  k = upsert(k, 'routes', { id: '10000000-0000-4000-8000-000000000009', game: null, ref: 'Route 1', name: 'Generic' }, 1)
  k = upsert(k, 'routes', { id: '10000000-0000-4000-8000-00000000000a', game: 'em', ref: 'Route 101', name: 'Emerald' }, 1)
  assert.deepEqual(forGame(k.routes, 'unbound').map((r) => r.name), ['Route 1', 'Generic'])
  assert.equal(forGame(k.routes, null).length, 3)
  assert.equal(findByRef(k, 'routes', 'em', 'Route 1').name, 'Generic')
})

test('note counts drive the game-page indicator', () => {
  const k = sample()
  assert.equal(noteCount(k, 'bosses', findByRef(k, 'bosses', 'unbound', 'r1')), 3) // strategy + 1 prep + 1 lesson
  assert.equal(noteCount(k, 'routes', findByRef(k, 'routes', 'unbound', 'Route 1')), 2) // dangers + 1 objective
  assert.equal(noteCount(k, 'routes', null), 0)
})
