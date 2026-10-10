import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  identityOf,
  normalizeSide,
  validateLinks,
  sanitizeImportedSide,
  buildExport,
  splitImport,
  SIDE_VERSION
} from '../../src/lib/unbound/side.js'

const baseline = { snapshot: { schema: 2, game: { saveIndex: 5 }, trainer: { id: 1, secretId: 2 }, party: [], boxes: [] }, source: 'upload', acceptedAt: 1 }
const tracker = {
  'Route 1': { id: 2, pokemon: 'larvitar', status: 1, location: 'Route 1' },
  'Route 2': { id: 3, pokemon: 'zubat', status: 1, location: 'Route 2' },
  'Route 3': {}, // cleared location
  __team: ['Route 1']
}

test('identity requires a non-zero 32-bit PID and OT ID', () => {
  assert.equal(identityOf({ pid: 7, otId: 65538 }), '65538:7')
  assert.equal(identityOf({ pid: 0xffffffff, otId: 1 }), '1:4294967295')
  for (const bad of [{ pid: 0, otId: 1 }, { pid: 1, otId: 0 }, { pid: 1 }, {}, null, { pid: -1, otId: 1 }, { pid: 1.5, otId: 1 }, { pid: 2 ** 32, otId: 1 }, { pid: '7', otId: 1 }])
    assert.equal(identityOf(bad), null, JSON.stringify(bad))
})

test('reads version-1 side keys and drops malformed parts', () => {
  assert.deepEqual(normalizeSide({ baseline }), { version: SIDE_VERSION, baseline, links: {}, facts: {} })
  assert.deepEqual(normalizeSide(null), { version: SIDE_VERSION, baseline: null, links: {}, facts: {} })
  assert.deepEqual(normalizeSide({ baseline: { snapshot: 'nope' }, links: [], facts: 'x' }), { version: SIDE_VERSION, baseline: null, links: {}, facts: {} })
})

test('validates links against tracker records', () => {
  const { links, rejected } = validateLinks(
    { '2:7': 'Route 1', '2:8': 'Route 3', '2:9': 'Gone', 'x:1': 'Route 2', '0:5': 'Route 2', '2:10': 'Route 2', '2:11': 'Route 2' },
    tracker
  )
  assert.deepEqual(links, { '2:7': 'Route 1' })
  assert.deepEqual(rejected.map((r) => [r.identity, r.reason]).sort(), [
    ['0:5', 'invalid-identity'],
    ['2:10', 'record-claimed-twice'],
    ['2:11', 'record-claimed-twice'],
    ['2:8', 'record-missing'],
    ['2:9', 'record-missing'],
    ['x:1', 'invalid-identity']
  ])
})

test('export adds __unbound only when there is Unbound data', () => {
  const meta = { id: 'run', name: 'Run' }
  assert.deepEqual(buildExport(meta, tracker, null), { __meta: meta, ...tracker })
  const out = buildExport(meta, tracker, { baseline, links: { '2:7': 'Route 1' } })
  assert.deepEqual(out.__unbound.links, { '2:7': 'Route 1' })
  assert.deepEqual(Object.keys(out).filter((k) => !k.startsWith('__')), ['Route 1', 'Route 2', 'Route 3'])
})

test('import keeps __unbound out of the tracker blob; old exports import unchanged', () => {
  const old = { __meta: { id: 'run' }, ...tracker }
  assert.deepEqual(splitImport(old), { meta: { id: 'run' }, tracker, unbound: undefined })

  const exported = buildExport({ id: 'run' }, tracker, { baseline, links: { '2:7': 'Route 1' } })
  const { meta, tracker: t, unbound } = splitImport(JSON.parse(JSON.stringify(exported)))
  assert.deepEqual(meta, { id: 'run' })
  assert.deepEqual(t, tracker)
  assert.equal('__unbound' in t, false)
  assert.ok(unbound)
})

test('imported links are validated; stale or invalid ones are rejected', () => {
  const result = sanitizeImportedSide(
    { version: 2, baseline, links: { '2:7': 'Route 1', '2:9': 'Gone', 'oops': 'Route 2' }, facts: { 'Route 1': { level: 5 }, Gone: { level: 9 } } },
    tracker
  )
  assert.deepEqual(result.side.links, { '2:7': 'Route 1' })
  assert.deepEqual(Object.keys(result.side.facts), ['Route 1'])
  assert.deepEqual(result.rejected.map((r) => r.reason).sort(), ['invalid-identity', 'record-missing'])
  assert.equal(sanitizeImportedSide({ links: { '2:9': 'Gone' } }, tracker), null) // nothing usable
  assert.equal(sanitizeImportedSide('garbage', tracker), null)
})
