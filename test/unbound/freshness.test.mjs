import { test } from 'node:test'
import assert from 'node:assert/strict'

import { syncAge, STALE_AFTER_MS } from '../../src/lib/unbound/freshness.js'

const NOW = Date.UTC(2026, 9, 10, 12, 0, 0)
const ago = (ms) => syncAge(NOW - ms, NOW)

test('describes how long ago a sync was accepted', () => {
  assert.deepEqual(ago(0), { label: 'just now', stale: false })
  assert.deepEqual(ago(59 * 1000), { label: 'just now', stale: false })
  assert.deepEqual(ago(5 * 60 * 1000), { label: '5 min ago', stale: false })
  assert.deepEqual(ago(3 * 60 * 60 * 1000 + 59 * 60 * 1000), { label: '3 h ago', stale: false })
  assert.deepEqual(ago(2 * 24 * 60 * 60 * 1000), { label: '2 d ago', stale: true })
})

test('flags data as possibly out of date after a day', () => {
  assert.equal(ago(STALE_AFTER_MS - 1).stale, false)
  assert.equal(ago(STALE_AFTER_MS).stale, true)
})

test('clock skew (future timestamps) does not produce negative ages', () => {
  assert.deepEqual(syncAge(NOW + 60 * 60 * 1000, NOW), { label: 'just now', stale: false })
})
