import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import equal from 'fast-deep-equal'

import { planReconciliation, applyReconciliation } from '../../src/lib/unbound/reconcile.js'
import { normalizeSide } from '../../src/lib/unbound/side.js'
import { parseUnboundSave } from '../../src/lib/unbound/parse.js'
import { aliasFor } from '../../src/lib/unbound/species.js'

// ---- Tracker Pokémon data (the same list the app serves for Unbound) -------

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const APP = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/routes/api/pokemon.json/_pokemon.json'), 'utf8'))
const BY_ALIAS = new Map(APP.map((p) => [p.alias, p]))
const lookup = (alias) => BY_ALIAS.get(alias)

// ---- Synthetic save + tracker ------------------------------------------------

const OT = 0x00020001 // secretId 2, id 1
const SP = { larvitar: 246, pupitar: 247, zubat: 41, golbat: 42, gastly: 92, haunter: 93, sandshrew: 27, sandshrewAlola: 1023, eevee: 133, rotomHeat: 713, snorunt: 361 }

const mon = (pid, speciesId, nickname, { level = 10, otId = OT, nature = 'Hardy', hp } = {}) => ({
  pid,
  otId,
  species: { id: speciesId },
  nickname,
  level,
  nature,
  ability: 'Guts',
  item: null,
  moves: ['Tackle'],
  ...(hp ? { hp, status: null } : {})
})
const partyMon = (pid, speciesId, nickname, opts) => mon(pid, speciesId, nickname, { hp: { current: 20, max: 20 }, ...opts })

const snapshot = ({ party = [], boxes = {}, saveIndex = 100 } = {}) => ({
  schema: 2,
  game: { saveIndex },
  trainer: { name: 'TEST', id: OT & 0xffff, secretId: OT >>> 16 },
  party,
  boxes: Array.from({ length: 25 }, (_, i) => ({ box: i + 1, mons: (boxes[i + 1] || []).map((m, s) => ({ ...m, box: i + 1, slot: s + 1 })) }))
})

// Records shaped exactly as pokemon-selector.svelte writes them
const record = (id, location, pokemon, extra = {}) => ({ id, pokemon, status: 1, location, ...extra })

const baseTracker = () => ({
  'Route 1': record(2, 'Route 1', 'larvitar', { nickname: 'Rocky', nature: 'careful' }),
  'Route 2': record(3, 'Route 2', 'zubat'),
  'Icicle Cave': record(4, 'Icicle Cave', 'sandshrew', { nickname: 'Quartz' }),
  'Route 3': record(5, 'Route 3', 'gastly', { status: 5, nickname: 'Boo', death: { type: 'trainer', lvl: { from: 9, to: 12 } } }),
  'Route 4': record(6, 'Route 4', 'eevee', { status: 4 }), // missed
  __team: ['Route 1'],
  __teams: [{ id: 'r1', name: 'Rival', group: 'rival', type: 'normal', team: [{ sprite: 'larvitar', id: 'Route 1' }] }],
  __custom: [{ type: 'custom', name: 'Gift', id: 'abc123', index: 3 }],
  __hidden: ['Route 9'],
  __starter: 'fire'
})

const plan = (snap, tracker, side = {}, choices) =>
  planReconciliation({ snapshot: snap, tracker, side: normalizeSide(side), lookup, choices })

const apply = (snap, tracker, side = {}, choices) => {
  const s = normalizeSide(side)
  const p = planReconciliation({ snapshot: snap, tracker, side: s, lookup, choices })
  return { plan: p, ...applyReconciliation({ tracker, side: s, plan: p, snapshot: snap, source: 'test', acceptedAt: 1 }) }
}

const id = (pid, otId = OT) => `${otId}:${pid}`

// ---- First-time linking -------------------------------------------------------

test('auto-links a unique same-line candidate with an exact nickname match', () => {
  const p = plan(snapshot({ party: [partyMon(11, SP.larvitar, 'ROCKY')] }), baseTracker())
  assert.deepEqual(p.autoLinks.map((l) => [l.identity, l.key, l.by]), [[id(11), 'Route 1', 'nickname']])
  assert.deepEqual(p.review, [])
})

test('an unnicknamed tracker record matches the species name stored in the save', () => {
  const p = plan(snapshot({ party: [partyMon(12, SP.zubat, 'ZUBAT')] }), baseTracker())
  assert.deepEqual(p.autoLinks.map((l) => l.key), ['Route 2'])
  assert.equal(p.updates.find((u) => u.key === 'Route 2')?.changes.nickname, undefined) // default name not written
})

test('a single candidate with a different nickname needs confirmation', () => {
  const p = plan(snapshot({ party: [partyMon(13, SP.larvitar, 'Pebble')] }), baseTracker())
  assert.deepEqual(p.autoLinks, [])
  assert.deepEqual(p.review.map((r) => [r.reason, r.candidates.map((c) => c.key)]), [['nickname-mismatch', ['Route 1']]])
  assert.deepEqual(p.updates, [])
})

test('duplicate species are ambiguous, never guessed', () => {
  const tracker = { ...baseTracker(), 'Route 5': record(7, 'Route 5', 'golbat') } // second unnicknamed Zubat line
  const p = plan(snapshot({ party: [partyMon(14, SP.zubat, 'ZUBAT')] }), tracker)
  assert.deepEqual(p.autoLinks, [])
  assert.deepEqual(p.review.map((r) => [r.reason, r.candidates.map((c) => c.key).sort()]), [['ambiguous', ['Route 2', 'Route 5']]])
})

test('duplicate nicknames are ambiguous in both directions', () => {
  // Two records named Bob
  const tracker = { ...baseTracker(), 'Route 5': record(7, 'Route 5', 'zubat', { nickname: 'Bob' }), 'Route 6': record(8, 'Route 6', 'zubat', { nickname: 'Bob' }) }
  const a = plan(snapshot({ party: [partyMon(15, SP.zubat, 'Bob')] }), tracker)
  assert.equal(a.review[0].reason, 'ambiguous')
  assert.deepEqual(a.autoLinks, [])

  // Two save mons both nicknamed after the single matching record
  const b = plan(snapshot({ party: [partyMon(16, SP.larvitar, 'Rocky'), partyMon(17, SP.larvitar, 'Rocky')] }), baseTracker())
  assert.deepEqual(b.autoLinks, [])
  assert.deepEqual(b.review.map((r) => r.reason), ['ambiguous', 'ambiguous'])
})

test('a different evolution line is never a candidate', () => {
  const p = plan(snapshot({ party: [partyMon(18, SP.snorunt, 'Rocky')] }), baseTracker())
  assert.deepEqual(p.autoLinks, [])
  assert.deepEqual(p.review, [])
  assert.deepEqual(p.unmatched.map((u) => u.mon.speciesId), [SP.snorunt])
})

test('records marked Missed are not candidates', () => {
  const p = plan(snapshot({ party: [partyMon(19, SP.eevee, 'EEVEE')] }), baseTracker())
  assert.deepEqual(p.unmatched.map((u) => u.identity), [id(19)])
})

test('missing and duplicated identities are unmatchable', () => {
  const p = plan(
    snapshot({ party: [partyMon(0, SP.larvitar, 'Rocky'), partyMon(20, SP.zubat, 'ZUBAT', { otId: 0 })], boxes: { 1: [mon(21, SP.sandshrew, 'Quartz'), mon(21, SP.sandshrew, 'Quartz')] } }),
    baseTracker()
  )
  assert.deepEqual(p.unmatchable.map((u) => u.reason).sort(), ['duplicate-identity', 'duplicate-identity', 'missing-identity', 'missing-identity'])
  assert.deepEqual(p.autoLinks, [])
  assert.deepEqual(Object.keys(p.links), [])
})

test('player decisions resolve reviews; invalid picks are ignored and skips recorded', () => {
  const snap = snapshot({ party: [partyMon(13, SP.larvitar, 'Pebble'), partyMon(22, SP.sandshrewAlola, 'Ice')] })
  const chosen = plan(snap, baseTracker(), {}, { [id(13)]: 'Route 1', [id(22)]: null })
  assert.deepEqual(chosen.autoLinks.map((l) => [l.key, l.by]), [['Route 1', 'player']])
  assert.deepEqual(chosen.skipped.map((s) => s.identity), [id(22)])
  assert.equal(chosen.updates.find((u) => u.key === 'Route 1').changes.nickname.to, 'Pebble')

  const invalid = plan(snap, baseTracker(), {}, { [id(13)]: 'Route 3' }) // dead gastly: not a candidate
  assert.equal(invalid.links[id(13)], undefined)
  assert.equal(invalid.review.find((r) => r.identity === id(13)).reason, 'nickname-mismatch')
})

// ---- Updates for linked mons ---------------------------------------------------------

test('evolution updates the existing record instead of creating a new one', () => {
  const tracker = baseTracker()
  const { tracker: out, plan: p } = apply(snapshot({ party: [partyMon(11, SP.pupitar, 'ROCKY', { nature: 'Careful' })] }), tracker, { links: { [id(11)]: 'Route 1' } })
  assert.deepEqual(p.updates.map((u) => [u.key, u.changes.pokemon]), [['Route 1', { from: 'larvitar', to: 'pupitar' }]])
  assert.deepEqual(Object.keys(out), Object.keys(tracker))
  assert.deepEqual(out['Route 1'], { ...tracker['Route 1'], pokemon: 'pupitar' })
})

test('linked nickname changes sync automatically', () => {
  const { tracker: out } = apply(snapshot({ party: [partyMon(11, SP.larvitar, 'Boulder', { nature: 'Careful' })] }), baseTracker(), { links: { [id(11)]: 'Route 1' } })
  assert.equal(out['Route 1'].nickname, 'Boulder')
})

test('case-only nickname differences keep the tracker spelling', () => {
  const { tracker: out, plan: p } = apply(snapshot({ party: [partyMon(11, SP.larvitar, 'ROCKY', { nature: 'Careful' })] }), baseTracker(), { links: { [id(11)]: 'Route 1' } })
  assert.deepEqual(p.updates, [])
  assert.equal(out['Route 1'].nickname, 'Rocky')
})

test('regional form corrects the tracker alias; unmapped forms leave it alone', () => {
  const a = apply(snapshot({ boxes: { 1: [mon(23, SP.sandshrewAlola, 'Quartz')] } }), baseTracker())
  assert.equal(a.tracker['Icicle Cave'].pokemon, 'sandshrew-alola')

  const tracker = { ...baseTracker(), 'Route 7': record(9, 'Route 7', 'rotom') }
  const b = apply(snapshot({ party: [partyMon(24, SP.rotomHeat, 'ROTOM')] }), tracker)
  assert.equal(b.plan.links[id(24)], 'Route 7')
  assert.equal(b.tracker['Route 7'].pokemon, 'rotom') // no verified alias for Rotom (Heat)
})

test('an alias missing from the runtime Pokémon data is never written', () => {
  // e.g. a game whose data patches drop a form: the build-time alias isn't trusted alone
  const limited = (alias) => (alias === 'pupitar' ? undefined : lookup(alias))
  const s = normalizeSide({ links: { [id(11)]: 'Route 1' } })
  const p = planReconciliation({ snapshot: snapshot({ party: [partyMon(11, SP.pupitar, 'Rocky', { nature: 'Careful' })] }), tracker: baseTracker(), side: s, lookup: limited })
  assert.deepEqual(p.updates, [])
  assert.deepEqual(p.unmappedSpecies.map((u) => [u.key, u.species]), [['Route 1', 'Pupitar']])
  assert.equal(p.links[id(11)], 'Route 1') // unverifiable, not stale: the link is kept
  assert.deepEqual(p.staleLinks, [])

  // ...but an unverifiable species never creates a new link
  const fresh = planReconciliation({ snapshot: snapshot({ party: [partyMon(11, SP.pupitar, 'Rocky')] }), tracker: baseTracker(), side: normalizeSide({}), lookup: limited })
  assert.deepEqual(fresh.autoLinks, [])
  assert.deepEqual(fresh.review, [])
})

test('party to box movement updates facts and mirrors __team', () => {
  const side = { links: { [id(11)]: 'Route 1', [id(12)]: 'Route 2' } }
  const before = apply(snapshot({ party: [partyMon(12, SP.zubat, 'ZUBAT'), partyMon(11, SP.larvitar, 'Rocky')] }), baseTracker(), side)
  assert.deepEqual(before.tracker.__team, ['Route 2', 'Route 1'])
  assert.equal(before.side.facts['Route 1'].where, 'party')

  const after = apply(snapshot({ party: [partyMon(12, SP.zubat, 'ZUBAT')], boxes: { 3: [mon(11, SP.larvitar, 'Rocky')] } }), before.tracker, before.side)
  assert.deepEqual(after.tracker.__team, ['Route 2'])
  assert.equal(after.side.facts['Route 1'].where, 'box 3')
})

test('__team is left alone while any party member is unlinked', () => {
  const p = plan(snapshot({ party: [partyMon(11, SP.larvitar, 'Rocky'), partyMon(18, SP.snorunt, 'Frosty')] }), baseTracker(), { links: { [id(11)]: 'Route 1' } })
  assert.equal(p.team.status, 'unresolved')
  assert.deepEqual(p.team.to, ['Route 1'])
})

test('Box 24 is only a possible-death suggestion', () => {
  const tracker = baseTracker()
  const { tracker: out, plan: p } = apply(snapshot({ boxes: { 24: [mon(11, SP.larvitar, 'Rocky', { nature: 'Careful' })] } }), tracker, { links: { [id(11)]: 'Route 1' } })
  assert.deepEqual(p.possibleDeaths.map((d) => d.key), ['Route 1'])
  assert.equal(out['Route 1'].status, 1)
  assert.equal(out['Route 1'].death, undefined)
})

test('a linked mon missing from the save is not deleted or killed', () => {
  const tracker = baseTracker()
  const { tracker: out, side, plan: p } = apply(snapshot({ party: [] }), tracker, { links: { [id(11)]: 'Route 1' } })
  assert.deepEqual(p.notFound, [{ identity: id(11), key: 'Route 1' }])
  assert.equal(out['Route 1'], tracker['Route 1'])
  assert.equal(side.links[id(11)], 'Route 1')
})

test('dead records are never modified; a dead mon in the party is flagged', () => {
  const tracker = baseTracker()
  const { tracker: out, plan: p } = apply(snapshot({ party: [partyMon(30, SP.haunter, 'Ghosty')] }), tracker, { links: { [id(30)]: 'Route 3' } })
  assert.deepEqual(out['Route 3'], tracker['Route 3'])
  assert.deepEqual(p.conflicts.map((c) => [c.key, c.reason]), [['Route 3', 'dead-in-party']])
  assert.deepEqual(out.__team, []) // dead excluded from the mirrored party
})

test('stale links are dropped and the mon is matched again', () => {
  // After a new attempt, 'Route 1' now holds a different species
  const tracker = { ...baseTracker(), 'Route 1': record(2, 'Route 1', 'snorunt') }
  const p = plan(snapshot({ party: [partyMon(11, SP.larvitar, 'Rocky')] }), tracker, { links: { [id(11)]: 'Route 1', [id(99)]: 'Nowhere', 'bad:id': 'Route 2' } })
  assert.deepEqual(p.staleLinks.map((s) => s.reason).sort(), ['invalid-identity', 'record-missing', 'species-mismatch'])
  assert.equal(p.links[id(11)], undefined)
  assert.deepEqual(p.updates, [])
})

// ---- Preservation, compatibility and idempotency --------------------------------------

test('only linked records and __team change; everything else is byte-identical', () => {
  const tracker = baseTracker()
  const snap = snapshot({ party: [partyMon(11, SP.pupitar, 'Rocky', { nature: 'Adamant' })], boxes: { 24: [mon(30, SP.gastly, 'Boo')] } })
  const { tracker: out } = apply(snap, tracker, { links: { [id(11)]: 'Route 1', [id(30)]: 'Route 3' } })
  for (const key of ['Route 2', 'Icicle Cave', 'Route 3', 'Route 4', '__teams', '__custom', '__hidden', '__starter'])
    assert.equal(JSON.stringify(out[key]), JSON.stringify(tracker[key]), key)
  const without = (r) => Object.fromEntries(Object.entries(r).filter(([k]) => k !== 'pokemon' && k !== 'nature'))
  assert.deepEqual(without(out['Route 1']), without(tracker['Route 1'])) // id, location, status, nickname untouched
  assert.deepEqual([out['Route 1'].pokemon, out['Route 1'].nature], ['pupitar', 'adamant'])
})

test('written records match what the encounter component would write', () => {
  // Mirrors pokemon-selector.svelte's `topatch` (nonnull + optional fields)
  const topatch = (r) =>
    Object.fromEntries(
      Object.entries({
        id: r.id,
        pokemon: r.pokemon,
        status: r.status,
        nature: r.nature,
        location: r.location,
        ...(r.nickname ? { nickname: r.nickname } : {}),
        ...(r.hidden ? { hidden: true } : {}),
        ...(r.status === 5 && r.death ? { death: r.death } : {})
      }).filter(([, v]) => v !== undefined && v !== null)
    )
  const { tracker: out, plan: p } = apply(snapshot({ party: [partyMon(11, SP.pupitar, 'Stone', { nature: 'Jolly' }), partyMon(12, SP.golbat, 'Wings')] }), baseTracker(), {
    links: { [id(11)]: 'Route 1', [id(12)]: 'Route 2' }
  })
  assert.equal(p.updates.length, 2)
  for (const u of p.updates) assert.ok(equal(topatch(out[u.key]), out[u.key]), u.key)
})

test('accepting the same save twice changes nothing the second time', () => {
  const snap = snapshot({ party: [partyMon(11, SP.pupitar, 'Rocky', { nature: 'Careful' }), partyMon(12, SP.zubat, 'ZUBAT')], boxes: { 24: [mon(23, SP.sandshrewAlola, 'Quartz')] } })
  const first = apply(snap, baseTracker())
  assert.ok(first.changed)
  const second = apply(snap, first.tracker, first.side)
  assert.equal(second.changed, false)
  assert.deepEqual(second.plan.updates, [])
  assert.deepEqual(second.plan.autoLinks, [])
  assert.equal(second.plan.team.status, 'unchanged')
  assert.equal(second.tracker, first.tracker) // same object: nothing rewritten
  assert.deepEqual(second.side.links, first.side.links)
})

test('links never duplicate across repeated accepts', () => {
  const snap = snapshot({ party: [partyMon(11, SP.larvitar, 'Rocky')] })
  let state = { tracker: baseTracker(), side: {} }
  for (let i = 0; i < 3; i++) state = apply(snap, state.tracker, state.side)
  assert.deepEqual(state.side.links, { [id(11)]: 'Route 1' })
  assert.equal(Object.keys(state.tracker).length, Object.keys(baseTracker()).length)
})

// ---- Real saves (skipped when fixtures are absent) -------------------------------------

const FIXTURES = path.join(ROOT, 'test/fixtures/unbound')
const saves = fs.existsSync(FIXTURES) ? fs.readdirSync(FIXTURES).filter((f) => f.endsWith('.sav')).sort() : []

test('real saves: a tracker built from the first save links fully and follows later saves', { skip: saves.length < 2 && 'needs two fixture saves' }, () => {
  const [first, ...rest] = saves.map((f) => parseUnboundSave(fs.readFileSync(path.join(FIXTURES, f))))
  const all = (s) => [...s.party, ...s.boxes.flatMap((b) => b.mons)]

  // One record per mon in the first save, entered with the verified alias and nickname
  const tracker = { __teams: [{ id: 'gym1', name: 'Gym', team: [] }], __custom: [] }
  all(first).forEach((m, i) => (tracker[`Location ${i}`] = record(i, `Location ${i}`, aliasFor(m.species.id), { nickname: m.nickname })))
  const teamsBefore = JSON.stringify(tracker.__teams)

  let state = apply(first, tracker, {})
  assert.equal(Object.keys(state.side.links).length, all(first).length, 'every mon auto-linked')
  assert.deepEqual(state.plan.review, [])

  for (const snap of rest) {
    const next = apply(snap, state.tracker, state.side)
    assert.equal(Object.keys(next.tracker).length, Object.keys(state.tracker).length, 'no records created or deleted')
    assert.equal(JSON.stringify(next.tracker.__teams), teamsBefore, '__teams untouched')
    // Every mon still in the save keeps its link; evolutions update in place
    for (const m of all(snap)) {
      const key = next.side.links[`${m.otId}:${m.pid}`]
      if (!key) continue
      assert.equal(next.tracker[key].pokemon, aliasFor(m.species.id) || next.tracker[key].pokemon)
    }
    assert.ok(next.plan.possibleDeaths.every((d) => next.tracker[d.key].status === 1), 'possible deaths not applied')
    assert.equal(apply(snap, next.tracker, next.side).changed, false, 're-applying is a no-op')
    state = next
  }
})
