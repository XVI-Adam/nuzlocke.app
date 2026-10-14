import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

import { nextBosses, savePosition, starterFromSave } from '../../src/lib/unbound/progress.js'

const ROUTES = JSON.parse(fs.readFileSync(new URL('../../src/lib/data/routes.json', import.meta.url), 'utf8'))
const UNBOUND = ROUTES.unbound
const values = (rs) => rs.map((r) => r.value)

test('no badges: bosses up to the first gym leader', () => {
  const nb = nextBosses(UNBOUND, { badges: 0, champion: false })
  assert.deepEqual(values(nb.upcoming), ['r1', 'r2', '1'])
  assert.equal(nb.next.value, 'r1')
  assert.equal(nb.goal.value, '1')
})

test('bosses the player recorded as defeated are skipped; nothing else is assumed', () => {
  const nb = nextBosses(UNBOUND, { badges: 0 }, ['r1'])
  assert.equal(nb.next.value, 'r2')
  assert.deepEqual(values(nb.upcoming), ['r2', '1'])
  // all recorded: nothing left before the badge
  assert.deepEqual(nextBosses(UNBOUND, { badges: 0 }, ['r1', 'r2', '1']).next, null)
})

test('after a badge, the list starts after that gym leader', () => {
  const nb = nextBosses(UNBOUND, { badges: 1 })
  assert.deepEqual(values(nb.upcoming), ['sh1', '2'])
  const four = nextBosses(UNBOUND, { badges: 4 })
  assert.ok(values(four.upcoming).includes('mb1'), 'mini-boss on the way to badge 5')
  assert.equal(four.goal.value, '5')
})

test('eight badges lead to the Champion; Champion means done', () => {
  const nb = nextBosses(UNBOUND, { badges: 8 })
  assert.equal(nb.goal.value, 'c')
  assert.ok(['e1', 'e2', 'e3', 'e4', 'c'].every((v) => values(nb.upcoming).includes(v)))
  assert.deepEqual(nextBosses(UNBOUND, { badges: 8, champion: true }), { next: null, upcoming: [], goal: null })
})

test('Expert routes (key_exp) work the same way', () => {
  const nb = nextBosses(ROUTES.unbound_exp, { badges: 1 })
  assert.deepEqual(values(nb.upcoming), ['sh1_exp', '2_exp'])
  assert.equal(nextBosses(ROUTES.unbound_exp, { badges: 8 }).goal.value, 'c_exp')
})

test('bad input never throws', () => {
  assert.deepEqual(nextBosses([], { badges: 3 }), { next: null, upcoming: [], goal: null })
  assert.equal(nextBosses(UNBOUND, {}).next.value, 'r1')
  assert.equal(nextBosses(UNBOUND, { badges: 99 }).goal.value, 'c')
})

test('save position is just after the last badge gym (or the Champion)', () => {
  assert.equal(savePosition(UNBOUND, { badges: 0 }), 0)
  const gym1 = UNBOUND.findIndex((r) => r.value === '1')
  assert.equal(savePosition(UNBOUND, { badges: 1 }), gym1 + 1)
  const champ = UNBOUND.findIndex((r) => r.value === 'c')
  assert.equal(savePosition(UNBOUND, { badges: 8, champion: true }), champ + 1)
  assert.equal(savePosition([], { badges: 3 }), 0)
})

test('starter comes only from the save mon linked to the Starter record', () => {
  const snapshot = {
    party: [{ otId: 1, pid: 10, species: { id: 371 } }],
    boxes: [{ box: 1, mons: [{ otId: 1, pid: 20, species: { id: 999 } }] }]
  }
  const deps = { aliasOf: (id) => ({ 371: 'gabite', 999: 'snorunt' })[id], evolineOf: (a) => ({ gabite: 'gible', snorunt: 'snorunt' })[a] }
  assert.equal(starterFromSave(snapshot, { '1:10': 'Starter' }, deps), 'fire')
  assert.equal(starterFromSave(snapshot, { '1:10': 'Route 1' }, deps), null, 'not linked to Starter')
  assert.equal(starterFromSave(snapshot, { '1:20': 'Starter' }, deps), null, 'not an Unbound starter line')
  assert.equal(starterFromSave(snapshot, {}, deps), null)
  assert.equal(starterFromSave(null, { '1:10': 'Starter' }, deps), null)
})
