import { test } from 'node:test'
import assert from 'node:assert/strict'

import { parseBattles, findBattle, compareTeam } from '../../tools/verify-unbound-bosses.mjs'
import { bossCheckFor, withBossChecks } from '../../src/lib/unbound/bosses.js'

// ---- Wiki parsing (synthetic page in the wiki's template formats)

const PAGE = `
=====Gym battle=====
{{Party/Single
|class=Gym Leader
|difficulty=Difficult
|location=Dresco Town
|pokemon=2
}}
|{{Pokémon/TrainerBoss
| ndex = 670
| pokemon = Floette
| form = -Blue
| level = 21
| ability = Flower Veil
| held = Grass Gem
| move1 = Fairy Wind
| move2 = Razor Leaf
| move3 = Hidden Power
| move4 = Echoed Voice
}}
|{{Pokémon/TrainerBoss
|ndex=479
|pokemon=Rotom
|form=-Fan
|level=20
|ability=Levitate
|move1=Air Slash|move2=Fail}}
{{Party/Footer}}
{{Party/Single
|difficulty=Expert & Insane
|location=Dresco Town
}}
|{{Pokémon/TrainerBoss
|pokemon=Comfey
|level=18
|ability=Triage}}
{{Party/Footer}}
====Frozen Heights====
<tabber>
|-|If the player chose Gible=
{{Party/Single
|difficulty=Difficult
|location=Frozen Heights
}}
|{{Pokémon/TrainerBoss
|pokemon=Larvitar
|level=13}}
{{Party/Footer}}
|-|If the player chose Beldum=
{{Party/Single
|difficulty=Difficult
|location=Frozen Heights
}}
|{{Pokémon/TrainerBoss
|pokemon=Gible
|level=13}}
{{Party/Footer}}
`
const battles = parseBattles(PAGE)

test('parses singles with both field styles, forms, tabs and difficulties', () => {
  assert.equal(battles.length, 4)
  assert.deepEqual(battles[0].mons[0], {
    species: 'Floette',
    form: '-Blue',
    level: 21,
    ability: 'Flower Veil',
    held: 'Grass Gem',
    moves: ['Fairy Wind', 'Razor Leaf', 'Hidden Power', 'Echoed Voice']
  })
  assert.equal(battles[2].tab, 'If the player chose Gible')
  assert.equal(battles[2].heading, 'Frozen Heights')
})

test('finds battles by location/heading, difficulty and starter tab', () => {
  assert.equal(findBattle(battles, { location: 'Dresco Town' }, 'Difficult').length, 1)
  assert.equal(findBattle(battles, { location: 'Dresco Town' }, 'Expert')[0].mons[0].species, 'Comfey')
  assert.equal(findBattle(battles, { heading: 'Frozen Heights' }, 'Difficult', 'fire')[0].mons[0].species, 'Larvitar')
  assert.equal(findBattle(battles, { heading: 'Frozen Heights' }, 'Difficult', 'water')[0].mons[0].species, 'Gible')
  assert.equal(findBattle(battles, { heading: 'Frozen Heights' }, 'Difficult', 'grass').length, 0)
})

const nameOf = (alias) => ({ floette: 'Floette', 'rotom-fan': 'Rotom', comfey: 'Comfey' })[alias] || alias

test('matching forms, wiki typos and typeless Hidden Power are not differences', () => {
  const app = [
    { name: 'floette', level: '21', ability: 'flower-veil', held: 'grass-gem', moves: ['fairy-wind', 'razor-leaf', 'hidden-power-grass', 'echoed-voice'] },
    { name: 'rotom-fan', level: '20', ability: 'levitate', moves: ['air-slash', 'flail'] }
  ]
  assert.deepEqual(compareTeam(app, battles[0].mons, nameOf), [])
})

test('real differences are reported, including duplicate moves and missing species', () => {
  const app = [
    { name: 'floette', level: '19', ability: 'symbiosis', moves: ['fairy-wind', 'fairy-wind', 'razor-leaf', 'echoed-voice'] },
    { name: 'comfey', level: '18', moves: [] }
  ]
  const diffs = compareTeam(app, battles[0].mons, nameOf)
  assert.ok(diffs.some((d) => /floette: level 19 \(wiki 21\)/.test(d)))
  assert.ok(diffs.some((d) => /floette: app lists a move twice/.test(d)))
  assert.ok(diffs.some((d) => /floette: moves/.test(d)))
  assert.ok(diffs.some((d) => /floette: ability symbiosis \(wiki Flower Veil\)/.test(d)))
  assert.ok(diffs.some((d) => /floette: held none \(wiki Grass Gem\)/.test(d)))
  assert.ok(diffs.includes('comfey: not in the wiki team'))
  assert.ok(diffs.includes('Rotom: in the wiki team, missing from the app'))
})

// ---- Attaching checks to the route list

const CHECKS = {
  source: 'https://pokemonunbound.miraheze.org',
  bosses: {
    1: { page: 'Mirskle', revid: 5, wikiDifficulty: 'Difficult', status: 'verified' },
    r1: { page: 'Ace', revid: 6, wikiDifficulty: 'Difficult', status: 'differs', diffs: ['x'], levelScaled: true },
    lr5: { status: 'post-game' }
  }
}
const ROUTES = [
  { type: 'route', name: 'Route 1', encounters: [] },
  { type: 'gym', name: 'Dresco Town Gym', value: '1', group: 'gym-leader' },
  { type: 'gym', name: 'Frozen Heights', value: 'r1', group: 'rival' },
  { type: 'gym', name: 'Ruins of Void', value: 'lr5', group: 'evil-team' }
]

test('checks attach to bosses only; everything else is unchanged', () => {
  const out = withBossChecks(ROUTES, CHECKS)
  assert.equal(out[0], ROUTES[0])
  assert.equal(out[3], ROUTES[3], 'post-game bosses get no check')
  assert.deepEqual({ ...out[1], bossCheck: undefined }, { ...ROUTES[1], bossCheck: undefined })
  assert.equal(out[1].bossCheck.status, 'verified')
  assert.equal(out[1].bossCheck.url, 'https://pokemonunbound.miraheze.org/wiki/Mirskle')
  assert.deepEqual(out[2].bossCheck.diffs, ['x'])
  assert.equal(out[2].bossCheck.levelScaled, true)
  assert.equal(bossCheckFor('nope', CHECKS), null)
})
