import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

import { parsePage, speciesResolver, mainStoryKeys, build } from '../../tools/build-unbound-encounters.mjs'
import { enrichedList, enrichRoutes } from '../../tools/build-unbound-encounters.mjs'
import { encounterDetailsFor, withEncounterDetails } from '../../src/lib/unbound/encounters.js'
import { GROUPS, GROUP_LABEL, groupOf, speciesOrder, rowsBySpecies, rowText, levelText, rateText } from '../../src/lib/unbound/encounter-groups.js'

const read = (p) => JSON.parse(fs.readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8'))
const POKEMON = read('src/routes/api/pokemon.json/_pokemon.json')
const ROUTES = read('src/lib/data/routes.json')
const resolve = speciesResolver(POKEMON)

// ---- Generator: wikitext parsing (synthetic pages in the wiki's template format)

const PAGE = `
== Wild Encounters ==
=== Regular Encounters ===
{{catch/header|land|yes}}
{{catch/div|land|Walking}}
{{catch/entryTimed|731|Pikipek|Grass|8–11|20%|0%|twoitems=no|item2=Oran Berry|type1=Normal|type2=flying}}
{{catch/entryAllDay|572|Mincinno|Grass|8–11|10%|twoitems=no|item1=Chesto Berry|type1=Normal|type2=Normal}}
{{catch/entryAllDay|027A|Sandshrew|Cave|8–10|10%|type1=Ice|type2=Steel}}
{{catch/entryAllDay|741P|Oricorio|form=Pa'u|Grass|9–12|5%|type1=Psychic}}
{{catch/entryTimed|083|Farfetch'd|Grass|53–57|35|0%|type1=normal}}
{{catch/entryTimed|164|Noctowl|Grass|48–53|0%|X%|type1=normal}}
{{catch/entryAllDay|279|Pelipper|Surf|45–40|10%|type1=Water}}
{{catch/div|land|Fish}}
{{catch/entryAllDay|129|Magikarp|Fish Old|10–15|100%|type1=Water}}
{{catch/div|land|Special}}
{{catch/entryAllDay|667|Litleo|Gift|???|Beat all the trainers in Challenge Road.|type1=Normal}}
{{catch/entryAllDay|580|Ducklett (Quacker)|Trade|20|Trade a [[Wingull]].|type1=Water}}
{{catch/entryAllDay|001|Bulbasaur|Egg|1|One possible Egg, 7.14% (pre-Post Game), 6.66% (Post Game)|type1=Grass}}
{{catch/entryAllDay|656|Froakie|Egg|1|One possible Egg, 6.66% (Post Game)|type1=Water}}
{{catch/footer|land}}
=== Cliff Cave ===
{{catch/header|cave}}
{{catch/div|cave|1F}}
{{catch/entryAllDay|066|Machop|Cave|50–55|20%|type1=Fighting}}
{{catch/footer|cave}}
== Special Encounters ==
{{catch/header|cave|yes}}
{{catch/div|cave|Walking}}
{{catch/entryAllDay|638|Cobalion|Cave|50|During a Mission|type1=Steel}}
{{catch/footer|cave}}
=== [[Swarm|Swarm Schedule]] ===
{{Swarm/head|land|261|Poochyena}}
=== Post-Game Cave ===
{{catch/header|cave}}
{{catch/entryAllDay|343|Baltoy|Cave|60–65|50%|type1=Ground}}
{{catch/footer|cave}}
`

const parsed = parsePage('Route 11', PAGE, resolve)
const rows = parsed.areas.flatMap((a) => a.encounters.map((e) => ({ ...e, area: a.area })))
const row = (species) => rows.find((r) => r.species === species)

test('timed and all-day rows keep method, levels and rates', () => {
  assert.deepEqual(row('pikipek'), { species: 'pikipek', method: 'grass', kind: 'wild', levels: [8, 11], rate: { day: 20, night: 0 }, area: null })
  assert.deepEqual(row('magikarp').rate, { all: 100 })
  assert.equal(row('magikarp').method, 'old-rod')
  assert.deepEqual(row('farfetchd').rate, { day: 35, night: 0 }, 'bare number is a percentage')
  assert.deepEqual(row('noctowl').rate, { day: 0, night: null }, '"X%" stays unknown')
})

test('species: typos, regional dex suffixes, named forms and trade nicknames', () => {
  assert.ok(row('minccino'), 'Mincinno -> Minccino')
  assert.ok(row('sandshrew-alola'), '027A -> Alolan')
  assert.ok(row('oricorio-pau'), "form=Pa'u -> oricorio-pau")
  assert.equal(row('ducklett').nickname, 'Quacker')
  assert.equal(row('ducklett').kind, 'trade')
  assert.equal(row('ducklett').note, 'Trade a Wingull.')
})

test('impossible level ranges are kept unknown with a note', () => {
  assert.equal(row('pelipper').levels, null)
  assert.equal(row('pelipper').levelsNote, 'Wiki lists "45–40"')
  assert.ok(parsed.unresolved.some((u) => u.includes('45–40')))
})

test('one-time encounters keep their description; special headings mark kind', () => {
  assert.equal(row('litleo').kind, 'gift')
  assert.equal(row('litleo').levels, null)
  assert.equal(row('litleo').note, 'Beat all the trainers in Challenge Road.')
  assert.equal(row('cobalion').kind, 'special')
  assert.equal(row('cobalion').rate, undefined)
})

test('post-game content and other route keys are excluded but remembered', () => {
  assert.ok(row('bulbasaur'), 'available before the post-game')
  assert.equal(row('froakie'), undefined)
  assert.equal(row('machop'), undefined, 'Cliff Cave is its own route key')
  assert.equal(row('baltoy'), undefined)
  assert.deepEqual(parsed.postGame.sort(), ['baltoy', 'froakie', 'machop'])
  assert.deepEqual(parsed.swarms, [{ species: 'poochyena' }])
  assert.deepEqual(parsed.unresolved.filter((u) => !u.includes('45–40')), [])
})

test('main story ends at the Champion and skips the starter pick', () => {
  const keys = mainStoryKeys(ROUTES.unbound)
  assert.equal(keys[0], 'Route 1')
  assert.equal(keys.at(-1), 'Victory Road')
  assert.ok(!keys.includes('Starter'))
  for (const post of ['Tomb of Borrius', 'Rift Cave', 'Redwood Forest', 'Cliff Cave', 'Cube Corp.']) assert.ok(!keys.includes(post))
})

test('build reports pages that are missing or have no tables', () => {
  const routes = [{ type: 'route', name: 'Route 1', encounters: [] }, { type: 'route', name: 'Route 2', encounters: [] }, { type: 'gym', value: 'c' }]
  const { locations, report } = build({ pages: { 'Route 1': { revid: 1, content: 'no tables' } } }, { routes, appPokemon: POKEMON })
  assert.deepEqual(locations, {})
  assert.deepEqual(report.missingPages, ['Route 2'])
  assert.deepEqual(report.empty, ['Route 1'])
})

// ---- Merging into the existing route data

const LOC = {
  page: 'Route 1',
  revid: 7,
  rows: [
    { species: 'magikarp', method: 'old-rod', kind: 'wild', levels: [10, 15], rate: { all: 100 } },
    { species: 'snorunt', method: 'grass', kind: 'wild', levels: [7, 9], rate: { all: 30 } },
    { species: 'litleo', method: 'gift', kind: 'gift', levels: null, note: 'Beat the trainers.' },
    { species: 'oricorio-baile', method: 'grass', kind: 'wild', levels: [7, 9], rate: { all: 5 } },
    { species: 'snorunt', method: 'surf', kind: 'wild', levels: [30, 35], rate: { all: 10 } },
    { species: 'poochyena', method: 'swarm', kind: 'swarm', levels: null }
  ],
  postGame: ['zapdos']
}
const DATA = { source: 'https://example.test', license: 'CC BY-SA 4.0', locations: { 'Route 1': LOC } }
const LEGACY = [
  { type: 'route', name: 'Starter', encounters: ['beldum'] },
  { type: 'route', name: 'Route 1', encounters: ['snorunt', 'oricorio', 'delibird', 'zapdos'], extra: 1 },
  { type: 'gym', name: 'Gym', value: '1', group: 'gym-leader', boss: 'Leader' }
]

test('the route list becomes documented species by method group, then older fallbacks', () => {
  const list = enrichedList(LEGACY[1].encounters, LOC)
  // grass (snorunt, oricorio-baile), old rod, swarm, gift; then delibird (fallback).
  // oricorio is covered by a documented form; zapdos is post-game only
  assert.deepEqual(list, ['snorunt', 'oricorio-baile', 'magikarp', 'poochyena', 'litleo', 'delibird'])
  assert.deepEqual(enrichedList(list, LOC), list, 'idempotent')
})

test('enrichRoutes changes only documented Unbound encounter lists', () => {
  const all = { unbound: LEGACY, unbound_exp: LEGACY, emerald: LEGACY }
  const out = enrichRoutes(all, { 'Route 1': LOC })
  assert.equal(out.emerald, LEGACY)
  for (const game of ['unbound', 'unbound_exp']) {
    assert.equal(out[game][0], LEGACY[0])
    assert.equal(out[game][2], LEGACY[2])
    assert.deepEqual({ ...out[game][1], encounters: LEGACY[1].encounters }, LEGACY[1])
  }
  assert.deepEqual(LEGACY[1].encounters, ['snorunt', 'oricorio', 'delibird', 'zapdos'], 'input not mutated')
})

test('the route API only attaches details; keys, lists and other fields are unchanged', () => {
  const out = withEncounterDetails(LEGACY, DATA)
  assert.equal(out[0], LEGACY[0])
  assert.equal(out[2], LEGACY[2])
  const { encounterDetails, ...rest } = out[1]
  assert.deepEqual(rest, LEGACY[1])
  assert.equal(encounterDetails.url, `${'https://pokemonunbound.miraheze.org'}/wiki/Route_1`)
  assert.equal(encounterDetails.revid, 7)
  assert.deepEqual(Object.keys(encounterDetails.species).sort(), ['litleo', 'magikarp', 'oricorio-baile', 'poochyena', 'snorunt'])
  assert.deepEqual(encounterDetails.species.snorunt.map((r) => r.method), ['grass', 'surf'])
  assert.equal(encounterDetailsFor({ type: 'gym', name: 'Route 1' }, DATA), null)
})

test('every real documented Unbound route gets details for each documented species', () => {
  for (const game of ['unbound', 'unbound_exp']) {
    const out = withEncounterDetails(ROUTES[game])
    assert.deepEqual(out.map((r) => r.name), ROUTES[game].map((r) => r.name))
    for (const r of out) {
      if (!r.encounterDetails) continue
      const withDetails = r.encounters.filter((s) => r.encounterDetails.species[s])
      assert.deepEqual(Object.keys(r.encounterDetails.species).sort(), [...withDetails].sort(), r.name)
    }
  }
})

// ---- Grouping and text for the picker

test('rows group by method (wild) or kind (one-off), in display order', () => {
  assert.equal(groupOf({ kind: 'wild', method: 'super-rod' }), 'super-rod')
  assert.equal(groupOf({ kind: 'special', method: 'grass' }), 'special')
  assert.equal(GROUP_LABEL['old-rod'], 'Old Rod')
  assert.deepEqual(GROUPS.map(([k]) => k).slice(0, 3), ['grass', 'cave', 'sand'])
  assert.deepEqual(speciesOrder(LOC.rows), ['snorunt', 'oricorio-baile', 'magikarp', 'poochyena', 'litleo'])
  assert.deepEqual(rowsBySpecies(LOC.rows).snorunt.map((r) => r.method), ['grass', 'surf'])
})

test('row text never invents values', () => {
  assert.equal(rowText({ levels: [8, 11], rate: { day: 20, night: 0 } }), 'Lv 8–11 · 20% day')
  assert.equal(rowText({ levels: [5, 5], rate: { day: 10, night: 30 } }), 'Lv 5 · 10% day · 30% night')
  assert.equal(rowText({ levels: [61, 65], rate: { all: null } }), 'Lv 61–65')
  // Noctowl: "0%" by day, "X%" at night -> only at night, rate not documented
  assert.equal(rowText({ levels: null, rate: { day: 0, night: null } }), 'night, rate unknown')
  assert.equal(rowText({ levels: null, rate: { day: 15, night: null } }), '15% day · night rate unknown')
  assert.equal(rowText({ levels: null, rate: { day: null, night: null } }), '')
  assert.equal(rowText({ levels: null, note: 'Beat the trainers.' }), 'Beat the trainers.')
  assert.equal(rowText({ levels: [20, 20], nickname: 'Quacker', note: 'Trade a Wingull.' }), 'Lv 20 · "Quacker" · Trade a Wingull.')
  assert.equal(rowText({ levels: null, area: '4F', rate: { all: 10 }, levelsNote: 'Wiki lists "45–40"' }), '10% · 4F · level Wiki lists "45–40"')
  assert.equal(levelText(null), '')
  assert.equal(rateText({ day: 20, night: 20 }), '20%')
})
