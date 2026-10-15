import { test } from 'node:test'
import assert from 'node:assert/strict'

import { parseSheet, parseSpecies, docTeam, compare, plan, replaceUnbound, syncStatic, checks } from '../../tools/import-unbound-bosses.mjs'

// Synthetic sheets in the trainer doc's layout (column 0 = labels)
const rows = (list) => list.map(([row, cells]) => ({ row, cells: Object.fromEntries(Object.entries(cells).map(([k, v]) => [k, String(v)])) }))

const GYM = {
  rows: rows([
    [1, { 0: 'Name', 1: '1. Mirskle (Grass)' }],
    [5, { 0: 'Pokemon Names', 1: 'Floette [1st lead]', 2: 'Mega Houndoom', 3: 'Alolan Raticate' }],
    [6, { 0: 'Level at Cap', 1: '21.0', 2: '33.0', 3: '36.0' }],
    [7, { 0: 'Ability', 1: 'Flower Veil', 2: 'Flash Fire → Solar Power', 3: 'Insomnia / Gluttony → Hustle' }],
    [8, { 0: 'Held Item', 1: 'Grass Gem', 2: 'Houndoomite' }],
    [9, { 0: 'Moves', 1: 'Fairy Wind', 2: 'Inferno', 3: 'Crunch' }],
    [10, { 1: 'Razor Leaf', 2: 'Inferno' }],
    [13, { 0: 'Nature', 1: 'Hardy' }],
    [20, { 1: 'Leader Mirskle - Difficult', 2: 'Leader Mirskle - Difficult', 3: 'Shadow Grunt w/ Mirskle - Difficu' }]
  ])
}
const RIVAL = {
  rows: rows([
    [1, { 1: 'PLAYER CHOSE GIBLE', 8: 'PLAYER CHOSE BELDUM', 15: 'PLAYER CHOSE LARVITAR' }],
    [2, { 0: 'Location', 1: 'Frozen Heights', 8: 'Frozen Heights', 15: 'Frozen Heights' }],
    [5, { 0: 'Pokemon Names', 1: 'Larvitar', 8: 'Gible', 15: 'Beldum' }],
    [6, { 0: 'Minimum Level', 1: '10.0', 8: '10.0', 15: '10.0' }],
    [7, { 0: 'Ability', 1: 'Guts', 8: 'Sand Veil', 15: 'Clear Body' }],
    [9, { 0: 'Moves', 1: 'Leer', 8: 'Tackle', 15: 'Tackle' }],
    [10, { 15: 'Metal Bash' }],
    [11, { 15: 'Metal Bash' }]
  ])
}

test('parses battle columns, footers, rival starter groups and levels', () => {
  const gym = parseSheet(GYM)
  assert.equal(gym.length, 3)
  assert.deepEqual(gym[0], {
    col: 1, footer: 'Leader Mirskle', location: '', group: null, species: 'Floette [1st lead]', level: 21,
    levelKind: 'Level at Cap', ability: 'Flower Veil', held: 'Grass Gem', moves: ['Fairy Wind', 'Razor Leaf'], nature: 'Hardy'
  })
  assert.equal(gym[2].footer, 'Shadow Grunt w/ Mirskle')
  const rival = parseSheet(RIVAL)
  assert.deepEqual(rival.map((m) => [m.group, m.location, m.species]), [
    ['fire', 'Frozen Heights', 'Larvitar'],
    ['water', 'Frozen Heights', 'Gible'],
    ['grass', 'Frozen Heights', 'Beldum']
  ])
  assert.equal(rival[0].levelKind, 'Minimum Level')
  assert.deepEqual(docTeam(rival, { location: 'Frozen Heights' }, 'grass').map((m) => m.species), ['Beldum'])
  assert.deepEqual(docTeam(gym, { title: ['Leader Mirskle', 'Shadow Grunt w/ Mirskle'] }).length, 3)
})

test('species notes, Mega and regional prefixes are normalised', () => {
  assert.deepEqual(parseSpecies("Duskull [Marlon's lead]"), { species: 'Duskull', mega: false, region: null })
  assert.deepEqual(parseSpecies('Mega Houndoom'), { species: 'Houndoom', mega: true, region: null })
  assert.deepEqual(parseSpecies('Alolan Raticate'), { species: 'Raticate', mega: false, region: 'alola' })
})

const nameOf = (a) => ({ floette: 'Floette', houndoom: 'Houndoom', 'raticate-alola': 'Raticate', beldum: 'Beldum' })[a] || a

test('base-before-Mega abilities, alternatives and padded move slots count as matching', () => {
  const doc = parseSheet(GYM)
  const app = [
    { name: 'floette', level: '21', ability: 'flower-veil', held: 'grass-gem', moves: ['fairy-wind', 'razor-leaf'] },
    { name: 'houndoom', level: '33', ability: 'flash-fire', held: 'houndoominite', moves: ['inferno'] },
    { name: 'raticate-alola', level: '36', ability: 'gluttony', moves: ['crunch'] }
  ]
  const diffs = compare(app, doc, { nameOf, levelScaled: false })
  assert.deepEqual(diffs, [{ mon: 'houndoom', field: 'held', app: 'houndoominite', doc: 'Houndoomite' }])
})

test('rival levels are not compared (Level Scaling); other fields are', () => {
  const doc = parseSheet(RIVAL).filter((m) => m.group === 'grass')
  const app = [{ name: 'beldum', level: '17', ability: 'clear-body', moves: ['tackle', 'double-iron-bash'], starter: 'grass' }]
  assert.deepEqual(compare(app, doc, { nameOf, levelScaled: true }), [
    { mon: 'beldum', field: 'moves', app: ['tackle', 'double-iron-bash'], doc: ['Tackle', 'Metal Bash'] }
  ])
})

const KNOWN = { moves: new Set(['tackle', 'metalbash', 'flail']), abilities: new Set(['clearbody']), items: new Set(['houndoominite']) }
const LEAGUE = {
  r1: { name: 'Rival', pokemon: [{ name: 'beldum', level: '10', moves: ['tackle', 'double-iron-bash'], ability: 'clear-body', starter: 'grass' }] },
  sh3: { name: 'Zeph', pokemon: [{ name: 'houndoom', level: '33', moves: [], held: 'houndoominite' }] }
}
const RESULT = {
  r1: { variants: { grass: { diffs: [{ mon: 'beldum', field: 'moves', app: ['tackle', 'double-iron-bash'], doc: ['Tackle', 'Metal Bash'] }] } } },
  sh3: { variants: { all: { diffs: [{ mon: 'houndoom', field: 'held', app: 'houndoominite', doc: 'Houndoomite' }] } } },
  r4: { variants: { fire: { missing: true } } }
}

test('only values that resolve to known ids are applied; the rest are reported', () => {
  const { next, applied, unsupported } = plan(RESULT, LEAGUE, KNOWN)
  assert.deepEqual(next.r1.pokemon[0].moves, ['tackle', 'metal-bash'])
  assert.equal(next.sh3.pokemon[0].held, 'houndoominite', 'misspelt item not applied')
  assert.equal(applied.length, 1)
  assert.deepEqual(unsupported.map((u) => u.reason), ['unknown item houndoomite', 'battle not found in the workbook'])
  assert.deepEqual(LEAGUE.r1.pokemon[0].moves, ['tackle', 'double-iron-bash'], 'input not mutated')
})

test('league.json rewrite touches only the "unbound" block, byte for byte elsewhere', () => {
  const unbound = { 1: { name: 'A', pokemon: [] } }
  const raw = `{\n  "other": {\n\n    "x": 1\n  },\n  "unbound": ${JSON.stringify(unbound, null, 2).replace(/\n/g, '\n  ')}\n}`
  assert.equal(replaceUnbound(raw, unbound, unbound), raw)
  const out = replaceUnbound(raw, unbound, { 1: { name: 'B', pokemon: [] } })
  assert.ok(out.startsWith('{\n  "other": {\n\n    "x": 1'), 'other sections keep their formatting')
  assert.equal(JSON.parse(out).unbound[1].name, 'B')
  assert.throws(() => replaceUnbound(raw.replace('"A"', '"Z"'), unbound, unbound), /expected format/)
})

test('prebuilt boss files reuse existing move objects or refuse to change', () => {
  const metalBash = { power: '60', type: 'steel', damage_class: 'physical', name: 'Metal Bash', effect: '' }
  const tackle = { power: 40, type: 'normal', damage_class: 'physical', name: 'Tackle', effect: '' }
  const files = {
    'unbound.grass.json': { r1: { pokemon: [{ name: 'beldum', moves: [tackle, { name: 'Double Iron Bash' }] }] } },
    'unbound_exp.grass.json': { r1_exp: { pokemon: [{ name: 'beldum', moves: [tackle, metalBash] }] } }
  }
  const { next, applied } = plan(RESULT, LEAGUE, KNOWN)
  const out = syncStatic(applied, next, files)
  assert.deepEqual(out['unbound.grass.json'].r1.pokemon[0].moves, [tackle, metalBash])
  assert.deepEqual(files['unbound.grass.json'].r1.pokemon[0].moves[1], { name: 'Double Iron Bash' }, 'input not mutated')
  const bad = { ...next, r1: { pokemon: [{ ...next.r1.pokemon[0], moves: ['flail'] }] } }
  assert.throws(() => syncStatic(applied, bad, files), /no prebuilt data for "flail"/)
})

test('check summary per boss key', () => {
  const c = checks({ ...RESULT, r1: { variants: { grass: { diffs: [] }, fire: { diffs: [] } } } })
  assert.equal(c.r1.status, 'verified')
  assert.equal(c.r1.levelScaled, true)
  assert.equal(c.sh3.status, 'differs')
  assert.deepEqual(c.sh3.diffs, ['houndoom: held houndoominite (doc Houndoomite)'])
  assert.equal(c.r4.status, 'unsupported')
})
