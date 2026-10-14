import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

import { locationFor, metLabel } from '../../src/lib/unbound/locations.js'
import ENCOUNTERS from '../../src/lib/data/unbound/encounters.data.js'

test('mapped ids resolve to route keys; unmapped ids are labelled unknown', () => {
  assert.deepEqual(locationFor(101), { id: 101, key: 'Route 1', label: 'Route 1', known: true, confirmed: false })
  assert.deepEqual(locationFor(7), { id: 7, key: null, label: 'Unknown location #7', known: false, confirmed: false })
  assert.equal(locationFor('101').key, 'Route 1')
  assert.equal(locationFor(undefined).label, 'Unknown location #?')
  assert.equal(locationFor(5, { 5: { key: 'Route 9', confirmed: true } }).confirmed, true)
})

test('labels mark unconfirmed mappings', () => {
  assert.equal(metLabel({ met: { locationId: 101, level: 9 } }), 'Route 1?')
  assert.equal(metLabel({ met: { locationId: 250, level: 9 } }), 'Unknown location #250')
  assert.equal(metLabel({}), '')
})

// ---- In-game evidence: the player's own saves (gitignored; skipped without them)

const FIXTURES = new URL('../fixtures/unbound/', import.meta.url)
const expectedFile = new URL('expected.json', FIXTURES)
const expected = fs.existsSync(expectedFile) ? JSON.parse(fs.readFileSync(expectedFile, 'utf8')) : null
const POKEMON = JSON.parse(fs.readFileSync(new URL('../../src/routes/api/pokemon.json/_pokemon.json', import.meta.url), 'utf8'))
const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '')
const byName = new Map()
for (const p of POKEMON) if (!byName.has(norm(p.name)) || norm(p.alias) === norm(p.name)) byName.set(norm(p.name), p)
const byAlias = new Map(POKEMON.map((p) => [p.alias, p]))
const lineOfLabel = (label) => {
  const alolan = /^Alolan /.test(label)
  const p = byName.get(norm(label.replace(/^Alolan /, '')))
  const alias = alolan ? `${p.alias}-alola` : p.alias
  return byAlias.get(alias)?.evoline || alias
}

test('every met location in the fixture saves is mapped and agrees with the documented tables', { skip: !expected && 'no local fixtures' }, () => {
  const mons = Object.values(expected.saves).flatMap((s) => Object.values(s.mons))
  for (const m of mons) {
    const loc = locationFor(m.met.locationId)
    assert.ok(loc.known, `met id ${m.met.locationId} (${m.species}) is unmapped`)
    if (loc.key === 'Starter') continue
    const line = lineOfLabel(m.species)
    const rows = ENCOUNTERS.locations[loc.key].rows
    const match = rows.some(
      (r) => (byAlias.get(r.species)?.evoline || r.species) === line && (!r.levels || (m.met.level >= r.levels[0] && m.met.level <= r.levels[1]))
    )
    assert.ok(match, `${m.species} met Lv ${m.met.level} is not documented at ${loc.key}`)
  }
})
