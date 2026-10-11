import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { parseSaves, formatSave } from '../../src/lib/history/saves.js'
import { listArchives, isWritableRun, archiveAndStartNew } from '../../src/lib/history/archive.js'
import { readKnowledge } from '../../src/lib/history/knowledge.js'
import { buildExport, splitImport, sanitizeImportedSide } from '../../src/lib/unbound/side.js'
import { MemoryStorage, seeded, tracker, side, RUN, NEW_RUN } from './helpers.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

// The run-list parser exactly as it was in store.js before Phase 5
const legacyParse = (gameData) =>
  (gameData || '')
    .split(',')
    .filter((i) => i.length)
    .map((i) => i.split('|'))
    .reduce((acc, [id, time, name, game, settings, attempts = 1]) => {
      const [created, updated] = time.split('>')
      return { ...acc, [id]: { id, created, ...(updated ? { updated } : {}), name: decodeURIComponent(name), game, settings, attempts } }
    }, {})

test('existing run lists parse exactly as before', () => {
  const list = [
    'a1b2c3d4-0000-4000-8000-000000000001|1690000000000>1695000000000|My%20Run%2C%20%7Cpipes%7C|unbound|01010|4',
    'a1b2c3d4-0000-4000-8000-000000000002|1690000000000|Emerald|em|',
    'a1b2c3d4-0000-4000-8000-000000000003|1690000000000|Old|frlg'
  ].join(',')
  assert.deepEqual(parseSaves(list), legacyParse(list))
  for (const save of Object.values(parseSaves(list))) assert.deepEqual(parseSaves(formatSave(save))[save.id].name, save.name)
})

test('a device from before Phase 5 loads with empty history and notes', () => {
  const s = seeded()
  s.removeItem(`nuzlocke.${RUN}.attempt`)
  assert.deepEqual(listArchives(s), [])
  assert.deepEqual(readKnowledge(s), { knowledge: { version: 1, routes: [], bosses: [], objectives: [], lessons: [] }, error: null })
  assert.equal(isWritableRun(s, RUN), true)
  // ...and can be archived without an attempt key
  archiveAndStartNew(s, { runId: RUN, newRunId: NEW_RUN, now: 1 })
  assert.equal(s.getItem('nuzlocke'), NEW_RUN)
})

test('legacy .nzsav files (no __unbound / __attempt) still import', () => {
  const legacy = JSON.parse(JSON.stringify({ __meta: { id: RUN, name: 'Old' }, ...tracker() }))
  const { meta, tracker: t, unbound, attempt } = splitImport(legacy)
  assert.equal(meta.name, 'Old')
  assert.deepEqual(t, tracker())
  assert.equal(unbound, undefined)
  assert.equal(attempt, undefined)
})

test('new .nzsav exports keep attempt notes out of the tracker blob', () => {
  const attempt = { version: 1, notes: 'n', checklist: {} }
  const file = JSON.parse(JSON.stringify(buildExport({ id: RUN }, tracker(), side(), attempt)))
  const { tracker: t, unbound, attempt: a } = splitImport(file)
  assert.deepEqual(t, tracker())
  assert.ok(!('__attempt' in t) && !('__unbound' in t))
  assert.deepEqual(a, attempt)
  assert.deepEqual(sanitizeImportedSide(unbound, t).side.links, side().links)
  // Empty notes are not exported at all
  assert.ok(!('__attempt' in buildExport({ id: RUN }, tracker(), null, { version: 1, notes: '', checklist: {} })))
})

test('Phase 5 code makes no external network requests', () => {
  const files = [
    ...fs.readdirSync(path.join(ROOT, 'src/lib/history')).map((f) => path.join(ROOT, 'src/lib/history', f)),
    ...fs.readdirSync(path.join(ROOT, 'src/lib/components/History')).map((f) => path.join(ROOT, 'src/lib/components/History', f)),
    ...['history', 'notes', 'backup'].flatMap((d) =>
      fs.readdirSync(path.join(ROOT, 'src/routes/(app)', d), { recursive: true }).map((f) => path.join(ROOT, 'src/routes/(app)', d, f))
    )
  ].filter((f) => /\.(js|svelte)$/.test(f))
  assert.ok(files.length > 5)
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8')
    for (const banned of ['sendBeacon', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'http://', 'https://', '//'.concat('cdn')])
      assert.ok(!src.includes(banned), `${path.relative(ROOT, f)} uses ${banned}`)
    // Only same-origin reads of the app's own static route list
    for (const m of src.matchAll(/fetch\(([^)]*)\)/g)) assert.match(m[1], /^`\/api\/route\//, `${path.relative(ROOT, f)}: ${m[0]}`)
  }
})

test('the new-attempt control no longer wipes the run in place', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src/lib/components/navs/GameHeading.svelte'), 'utf8')
  assert.ok(!src.includes(".set('{}')"), 'GameHeading must not reset the tracker directly')
  assert.ok(src.includes('/history/new-attempt'))
})

test('a fresh run created by the new-attempt flow has no stale side or attempt keys', () => {
  const s = seeded()
  archiveAndStartNew(s, { runId: RUN, newRunId: NEW_RUN, now: 1 })
  const keys = Object.keys(s.dump()).filter((k) => k.includes(NEW_RUN))
  assert.deepEqual(keys, [`nuzlocke.${NEW_RUN}`])
})
