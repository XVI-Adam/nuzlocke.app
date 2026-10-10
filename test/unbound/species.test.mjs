import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

import { buildSpeciesTable, iconNamesFromCss } from '../../src/lib/unbound/forms.js'
import { describeSpecies, iconFor, FALLBACK_ICON } from '../../src/lib/unbound/species.js'
import { decodeStatus } from '../../src/lib/unbound/parse.js'
import SPECIES from '../../src/lib/unbound/species.data.js'
import { generate, OUT, ICON_CSS } from '../../tools/build-unbound-species.mjs'

const ICONS = iconNamesFromCss(fs.readFileSync(ICON_CSS, 'utf8'))
const pick = (id) => {
  const { label, form, icon } = describeSpecies(id)
  return { label, form, icon }
}

test('generated species table is up to date', () => {
  assert.equal(fs.readFileSync(OUT, 'utf8'), generate(), 'run: node tools/build-unbound-species.mjs')
})

// ---- Real Unbound data ---------------------------------------------------------

test('Gyarados is not mislabelled as a numbered form', () => {
  assert.deepEqual(pick(130), { label: 'Gyarados', form: null, icon: 'gyarados' })
  assert.deepEqual(pick(880), { label: 'Mega Gyarados', form: 'Mega', icon: 'gyarados-mega' })
  assert.equal(describeSpecies(880).name, 'Gyarados')
  assert.equal(describeSpecies(880).formKey, 'MEGA')
})

test('representative alternate forms get correct names and icons', () => {
  const cases = {
    1023: ['Alolan Sandshrew', 'sandshrew-alola'],
    1220: ['Galarian Mr. Mime', 'mr-mime-galar'],
    1234: ['Hisuian Growlithe', 'growlithe-hisui'],
    737: ['Darmanitan (Zen Mode)', 'darmanitan-zen'],
    1231: ['Galarian Darmanitan (Zen Mode)', 'darmanitan-galar-zen'],
    870: ['Mega Charizard X', 'charizard-mega-x'],
    909: ['Primal Groudon', 'groudon-primal'],
    1261: ['Gigantamax Charizard', 'charizard-gmax'],
    839: ['Ash-Greninja', 'greninja-ash'],
    713: ['Rotom (Heat)', 'rotom-heat'],
    1040: ['Deoxys (Attack)', 'deoxys-attack'],
    439: ['Unown (?)', 'unown-question'],
    864: ['Furfrou (La Reine)', 'furfrou-la-reine'],
    1254: ['Basculegion (Male)', 'basculegion-male'],
    837: ['Zygarde (10% Forme)', 'zygarde-10']
  }
  for (const [id, [label, icon]] of Object.entries(cases)) assert.deepEqual([pick(id).label, pick(id).icon], [label, icon], id)
})

test('ordinary species and evolutions keep plain names', () => {
  for (const [id, label] of [[27, 'Sandshrew'], [92, 'Gastly'], [93, 'Haunter'], [246, 'Larvitar'], [247, 'Pupitar'], [143, 'Snorlax']]) {
    assert.deepEqual(pick(id), { label, form: null, icon: label.toLowerCase() }, String(id))
  }
})

test('garbled and truncated ROM names are restored from the species constant', () => {
  assert.equal(pick(29).label, 'Nidoran♀')
  assert.equal(pick(32).label, 'Nidoran♂')
  assert.equal(pick(122).label, 'Mr. Mime')
  assert.equal(pick(840).label, 'Flabébé (Blue)')
  const byName = (n) => Object.values(SPECIES).find((e) => e.name === n)
  for (const n of ['Crabominable', 'Corviknight', 'Polteageist', 'Basculegion']) assert.ok(byName(n), n)
  assert.ok(!byName('Crabminble'))
})

test('ambiguous short form codes fall back visibly instead of guessing', () => {
  for (const [id, label] of [[1043, 'Oricorio (form Y)'], [854, 'Pumpkaboo (form L)'], [1046, 'Lycanroc (form N)']]) {
    const s = describeSpecies(id)
    assert.equal(s.label, label)
    assert.equal(s.formKnown, false)
    assert.equal(s.icon, null) // no icon rather than the wrong one
  }
})

test('unknown and placeholder ids get a clear fallback', () => {
  for (const id of [0, 253, 99999]) {
    assert.equal(describeSpecies(id).label, `Unknown species #${id}`)
    assert.equal(describeSpecies(id).name, null)
    assert.equal(iconFor(id), FALLBACK_ICON)
  }
  assert.deepEqual(pick(252), { label: 'Egg', form: null, icon: 'egg' })
})

test('every icon used exists in the icon stylesheet, including the fallback', () => {
  assert.ok(ICONS.has(FALLBACK_ICON))
  for (const [id, s] of Object.entries(SPECIES)) if (s.icon) assert.ok(ICONS.has(s.icon), `${id} ${s.icon}`)
})

// ---- Naming rules on synthetic data ------------------------------------------------

test('same short code is not interpreted the same way across species', () => {
  const t = buildSpeciesTable({
    names: { 1: 'Unown', 2: 'Unown', 3: 'Pumpkaboo', 4: 'Pumpkaboo', 5: 'Basculegion', 6: 'Basculegion' },
    constants: {
      1: 'SPECIES_UNOWN',
      2: 'SPECIES_UNOWN_M',
      3: 'SPECIES_PUMPKABOO',
      4: 'SPECIES_PUMPKABOO_M',
      5: 'SPECIES_BASCULEGION_M',
      6: 'SPECIES_BASCULEGION_F'
    },
    iconNames: new Set(['unown', 'unown-m', 'pumpkaboo', 'pumpkaboo-m'])
  })
  assert.equal(t[2].label, 'Unown (M)')
  assert.equal(t[4].label, 'Pumpkaboo (form M)')
  assert.equal(t[4].icon, null) // even though a pumpkaboo-m icon exists
  assert.equal(t[5].label, 'Basculegion (Male)')
  assert.equal(t[6].label, 'Basculegion (Female)')
})

test('a form without a matching icon gets none, never the base icon', () => {
  const t = buildSpeciesTable({
    names: { 1: 'Foo', 2: 'Foo' },
    constants: { 1: 'SPECIES_FOO', 2: 'SPECIES_FOO_A' },
    iconNames: new Set(['foo'])
  })
  assert.deepEqual([t[1].label, t[1].icon], ['Foo', 'foo'])
  assert.deepEqual([t[2].label, t[2].icon], ['Alolan Foo', null])
})

test('species with the same display name but no shared root are not merged into forms', () => {
  const t = buildSpeciesTable({
    names: { 1: 'Odd', 2: 'Odd' },
    constants: { 1: 'SPECIES_ALPHA', 2: 'SPECIES_BETA' },
    iconNames: new Set()
  })
  assert.equal(t[1].form, null)
  assert.equal(t[2].form, null)
})

// ---- Status conditions ----------------------------------------------------------------

test('decodes Gen 3 status conditions and flags impossible values', () => {
  assert.equal(decodeStatus(0), null)
  assert.equal(decodeStatus(1), 'sleep')
  assert.equal(decodeStatus(7), 'sleep')
  assert.equal(decodeStatus(0x08), 'poison')
  assert.equal(decodeStatus(0x10), 'burn')
  assert.equal(decodeStatus(0x20), 'freeze')
  assert.equal(decodeStatus(0x40), 'paralysis')
  assert.equal(decodeStatus(0x80), 'toxic')
  assert.equal(decodeStatus(0x18), 'unknown') // poison + burn at once
  assert.equal(decodeStatus(0x100), 'unknown')
})

// ---- Tracker aliases ------------------------------------------------------------------

test('every tracker alias exists in the app Pokémon data under the same name', async () => {
  const { APP_POKEMON } = await import('../../tools/build-unbound-species.mjs')
  const app = new Map(JSON.parse(fs.readFileSync(APP_POKEMON, 'utf8')).map((p) => [p.alias, p.name]))
  const key = (s) => s.normalize('NFD').replace(/[^A-Za-z0-9]/g, '').toLowerCase()
  for (const [id, s] of Object.entries(SPECIES)) {
    if (!s.alias) continue
    assert.ok(app.has(s.alias), `${id} ${s.alias}`)
    assert.equal(key(app.get(s.alias)), key(s.name), `${id} ${s.alias}`)
  }
})

test('aliases are only assigned where the tracker has that exact form', () => {
  const alias = (id) => describeSpecies(id).alias
  assert.equal(alias(130), 'gyarados')
  assert.equal(alias(880), 'gyarados-mega')
  assert.equal(alias(1023), 'sandshrew-alola')
  assert.equal(alias(247), 'pupitar')
  assert.equal(alias(713), null) // Rotom (Heat): no matching tracker form
  assert.equal(alias(1043), null) // unreviewed short code
  assert.equal(alias(252), null) // Egg
  const thundurus = Object.entries(SPECIES).find(([, s]) => s.name === 'Thundurus' && !s.form)
  assert.equal(thundurus[1].alias, null) // tracker only has the Therian form
})
