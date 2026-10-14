import { test } from 'node:test'
import assert from 'node:assert/strict'

import { levelCapFor, snapshotCap, overCap, capLabel, UNCAPPED } from '../../src/lib/unbound/caps.js'

// Difficult and higher (Unbound Wiki "Level Cap" oldid 17810; PokeCoders) -
// see src/lib/data/unbound/provenance.json
const DIFFICULT = [
  { badges: 0, cap: 20 },
  { badges: 1, cap: 26 },
  { badges: 2, cap: 32 },
  { badges: 3, cap: 36 },
  { badges: 4, cap: 40, upTo: 45 },
  { badges: 5, cap: 52 },
  { badges: 6, cap: 57 },
  { badges: 7, cap: 61 },
  { badges: 8, cap: 75 }
]

for (const { badges, cap, upTo = null } of DIFFICULT) {
  test(`${badges} badges -> cap ${cap}${upTo ? ` (${upTo} after Tarmigan Mansion)` : ''}`, () => {
    const info = levelCapFor({ badges, champion: false })
    assert.equal(info.cap, cap)
    assert.equal(info.upTo, upTo)
    assert.equal(info.milestone?.id ?? null, upTo ? 'tarmigan-mansion' : null)
    assert.equal(snapshotCap({ badgeCount: badges, isChampion: false }), cap)
  })
}

test('Champion removes the cap', () => {
  for (const badges of [0, 8]) {
    const info = levelCapFor({ badges, champion: true })
    assert.equal(info.cap, null)
    assert.equal(info.upTo, null)
    assert.equal(capLabel(info), 'None (Champion)')
    assert.equal(snapshotCap({ badgeCount: badges, isChampion: true }), UNCAPPED)
  }
})

test('accepts parser progress ({badgeCount,isChampion}) and snapshot progress ({badges,champion})', () => {
  assert.deepEqual(levelCapFor({ badgeCount: 3, isChampion: false }), levelCapFor({ badges: 3, champion: false }))
})

test('out-of-range and missing badge counts are clamped', () => {
  assert.equal(levelCapFor({}).cap, 20)
  assert.equal(levelCapFor({ badges: -2 }).cap, 20)
  assert.equal(levelCapFor({ badges: 12 }).cap, 75)
  assert.equal(levelCapFor({ badges: 'x' }).cap, 20)
})

test('overCap separates certain and milestone-dependent overs', () => {
  const mons = [{ level: 39 }, { level: 40 }, { level: 41 }, { level: 45 }, { level: 46 }]
  const four = overCap(mons, levelCapFor({ badges: 4 }))
  assert.deepEqual(four.over.map((m) => m.level), [46])
  assert.deepEqual(four.maybeOver.map((m) => m.level), [41, 45])

  const five = overCap(mons, levelCapFor({ badges: 5 }))
  assert.deepEqual(five, { over: [], maybeOver: [] })

  const one = overCap([{ level: 26 }, { level: 27 }], levelCapFor({ badges: 1 }))
  assert.deepEqual(one.over.map((m) => m.level), [27])
  assert.deepEqual(one.maybeOver, [])

  assert.deepEqual(overCap(mons, levelCapFor({ badges: 8, champion: true })), { over: [], maybeOver: [] })
  assert.deepEqual(overCap(undefined, null), { over: [], maybeOver: [] })
})

test('labels', () => {
  assert.equal(capLabel(levelCapFor({ badges: 2 })), '32')
  assert.equal(capLabel(levelCapFor({ badges: 4 })), '40 (45 after Tarmigan Mansion)')
  assert.equal(capLabel(null), '')
})
