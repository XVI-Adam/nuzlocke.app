import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  archiveAndStartNew,
  discardAndStartNew,
  listArchives,
  readArchive,
  updateArchiveMeta,
  deleteArchive,
  summarizeAttempt,
  isWritableRun,
  recordedFights,
  HistoryError
} from '../../src/lib/history/archive.js'
import { parseSaves } from '../../src/lib/history/saves.js'
import { readAttempt, writeAttempt, setChecked } from '../../src/lib/history/attempt.js'
import { normalizeSide } from '../../src/lib/unbound/side.js'
import { planReconciliation } from '../../src/lib/unbound/reconcile.js'
import { MemoryStorage, seeded, tracker, side, snapshot, run, RUN, NEW_RUN, OTHER_RUN, OT } from './helpers.mjs'

const NOW = 1700000500000
const archive = (s, extra = {}) => archiveAndStartNew(s, { runId: RUN, newRunId: NEW_RUN, now: NOW, ...extra })

// ---- Archive and reset --------------------------------------------------------

test('archiving keeps a complete, independent copy of the run', () => {
  const s = seeded()
  archive(s, { title: 'Attempt 2 – Rival wipe', status: 'lost', summary: 'Crit on Boo' })

  const { meta, data } = readArchive(s, RUN)
  assert.deepEqual(data.tracker, tracker()) // records, deaths, __team, __teams, __custom, __hidden, __starter
  assert.deepEqual(data.unbound, side()) // baseline incl. party/PC boxes, links and facts
  assert.equal(data.attempt.notes, 'Lost to the crit')
  assert.deepEqual(data.attempt.checklist, { 'obj-1': { done: true, at: 5 } })
  assert.deepEqual(meta, {
    id: RUN,
    title: 'Attempt 2 – Rival wipe',
    name: 'Unbound Run',
    game: 'unbound',
    settings: '',
    attemptNumber: 2,
    created: 1690000000000,
    updated: 1695000000000,
    archivedAt: NOW,
    status: 'lost',
    summary: 'Crit on Boo'
  })

  // Independent copy: the archive has its own key, the run's keys are gone
  assert.equal(s.getItem(`nuzlocke.${RUN}`), null)
  assert.equal(s.getItem(`nuzlocke.${RUN}.unbound`), null)
  assert.equal(s.getItem(`nuzlocke.${RUN}.attempt`), null)
  data.tracker['Route 1'].pokemon = 'mutated'
  assert.equal(readArchive(s, RUN).data.tracker['Route 1'].pokemon, 'larvitar')
})

test('starting a new attempt creates isolated tracker state with a new id', () => {
  const s = seeded()
  archive(s)
  const saves = parseSaves(s.getItem('nuzlocke.saves'))
  assert.deepEqual(Object.keys(saves), [NEW_RUN])
  assert.equal(saves[NEW_RUN].name, 'Unbound Run')
  assert.equal(saves[NEW_RUN].game, 'unbound')
  assert.equal(+saves[NEW_RUN].attempts, 3)
  assert.equal(+saves[NEW_RUN].created, NOW)
  assert.equal(s.getItem('nuzlocke'), NEW_RUN)
  assert.equal(s.getItem(`nuzlocke.${NEW_RUN}`), '{}')
  assert.equal(s.getItem(`nuzlocke.${NEW_RUN}.unbound`), null)
  assert.deepEqual(readAttempt(s, NEW_RUN).attempt.checklist, {})
  // Unrelated keys untouched
  assert.equal(s.getItem('nuzlocke.theme'), 'dark')
})

test('an archive-write failure leaves the original attempt untouched', () => {
  for (const failing of ['nuzlocke.archive.', 'nuzlocke.archive', 'nuzlocke.saves', `nuzlocke.${NEW_RUN}`, 'nuzlocke']) {
    const s = seeded()
    const before = s.dump()
    s.failWhen = (key) => key === (failing.endsWith('.') ? failing + RUN : failing)
    assert.throws(() => archive(s), (e) => e instanceof HistoryError && /not changed/.test(e.message), failing)
    assert.deepEqual(s.dump(), before, `state restored after failing ${failing}`)
  }
})

test('a quota error is reported as such', () => {
  const s = seeded()
  s.failWhen = (key) => key.startsWith('nuzlocke.archive.')
  assert.throws(() => archive(s), (e) => e.code === 'quota' && /storage is full/i.test(e.message))
})

test('unreadable run data or history index blocks archiving instead of losing data', () => {
  for (const [key, raw] of [
    [`nuzlocke.${RUN}`, '{broken'],
    [`nuzlocke.${RUN}.unbound`, 'nope'],
    [`nuzlocke.${RUN}.attempt`, '{'],
    ['nuzlocke.archive', '{bad json']
  ]) {
    const s = seeded()
    s.setItem(key, raw)
    const before = s.dump()
    assert.throws(() => archive(s), HistoryError, key)
    assert.deepEqual(s.dump(), before, key)
  }
})

test('an existing archive with the same id is never overwritten', () => {
  const s = seeded()
  s.setItem(`nuzlocke.archive.${RUN}`, '{"version":1,"tracker":{}}')
  const before = s.dump()
  assert.throws(() => archive(s), (e) => e.code === 'archive-exists')
  assert.deepEqual(s.dump(), before)
})

test('old Unbound links cannot affect the new attempt', () => {
  const s = seeded()
  archive(s)
  // The new attempt catches something on the same route key as the old link
  const fresh = { 'Route 1': { id: 2, pokemon: 'larvitar', status: 1, location: 'Route 1', nickname: 'New' } }
  s.setItem(`nuzlocke.${NEW_RUN}`, JSON.stringify(fresh))
  const newSide = normalizeSide(JSON.parse(s.getItem(`nuzlocke.${NEW_RUN}.unbound`)))
  assert.deepEqual(newSide.links, {})

  const save = snapshot({ party: [{ pid: 11, otId: OT, species: { id: 246 }, nickname: 'ROCKY', level: 20, nature: 'Adamant', moves: [], hp: { current: 1, max: 1 } }] })
  const lookup = (alias) => (alias === 'larvitar' ? { alias, name: 'Larvitar', evoline: 'larvitar' } : undefined)
  const plan = planReconciliation({ snapshot: save, tracker: fresh, side: newSide, lookup })
  assert.deepEqual(plan.updates, [], 'no update through an old link')
  assert.deepEqual(plan.autoLinks, [])

  // Before Phase 5 the reset kept the run id and side key: the stale link
  // would have rewritten the new record
  const stale = planReconciliation({ snapshot: save, tracker: fresh, side: normalizeSide(side()), lookup })
  assert.ok(stale.updates.length > 0, 'the old behaviour this guards against')
})

test('canceling (not calling archive) changes nothing; discard needs no archive and removes the run', () => {
  const s = seeded()
  const before = s.dump()
  // Cancel is a UI no-op: nothing runs, nothing changes
  assert.deepEqual(s.dump(), before)

  discardAndStartNew(s, { runId: RUN, newRunId: NEW_RUN, now: NOW })
  assert.equal(s.getItem(`nuzlocke.${RUN}`), null)
  assert.equal(s.getItem(`nuzlocke.${RUN}.unbound`), null)
  assert.equal(s.getItem(`nuzlocke.${RUN}.attempt`), null)
  assert.equal(s.getItem('nuzlocke.archive'), null)
  assert.equal(s.getItem('nuzlocke'), NEW_RUN)
  assert.equal(s.getItem(`nuzlocke.${NEW_RUN}`), '{}')
})

test('discard failure keeps the original run', () => {
  const s = seeded()
  const before = s.dump()
  s.failWhen = (key) => key === 'nuzlocke.saves'
  assert.throws(() => discardAndStartNew(s, { runId: RUN, newRunId: NEW_RUN, now: NOW }), HistoryError)
  assert.deepEqual(s.dump(), before)
})

test('a missing run or bad new id is rejected', () => {
  const s = seeded()
  assert.throws(() => archiveAndStartNew(s, { runId: OTHER_RUN, newRunId: NEW_RUN, now: NOW }), (e) => e.code === 'run-not-found')
  assert.throws(() => archiveAndStartNew(s, { runId: RUN, newRunId: RUN, now: NOW }), (e) => e.code === 'bad-new-id')
  assert.throws(() => archiveAndStartNew(s, { runId: RUN, newRunId: 'bad|id', now: NOW }), (e) => e.code === 'bad-new-id')
})

// ---- History -------------------------------------------------------------------

test('multiple attempts are stored and listed newest first; other runs are kept', () => {
  const s = seeded({ runs: [run(), run(OTHER_RUN, { name: 'Other game', game: 'em' })] })
  archive(s, { title: 'One' })
  // Attempt 3 goes on to be archived too
  archiveAndStartNew(s, { runId: NEW_RUN, newRunId: 'dddddddd-4444-4444-8444-444444444444', now: NOW + 10, title: 'Two', status: 'abandoned' })

  const list = listArchives(s)
  assert.deepEqual(list.map((a) => a.meta.title), ['Two', 'One'])
  assert.deepEqual(list.map((a) => a.meta.attemptNumber), [3, 2])
  assert.equal(list[0].meta.status, 'abandoned')
  assert.ok(parseSaves(s.getItem('nuzlocke.saves'))[OTHER_RUN], 'unrelated run kept')
  assert.equal(s.getItem(`nuzlocke.${OTHER_RUN}`), JSON.stringify(tracker()))
})

test('deleting one archived attempt does not affect the others', () => {
  const s = seeded()
  archive(s, { title: 'One' })
  archiveAndStartNew(s, { runId: NEW_RUN, newRunId: 'dddddddd-4444-4444-8444-444444444444', now: NOW + 10, title: 'Two' })
  const keep = s.getItem(`nuzlocke.archive.${RUN}`)
  deleteArchive(s, NEW_RUN)
  assert.deepEqual(listArchives(s).map((a) => a.meta.title), ['One'])
  assert.equal(s.getItem(`nuzlocke.archive.${NEW_RUN}`), null)
  assert.equal(s.getItem(`nuzlocke.archive.${RUN}`), keep)
})

test('historical boss teams and death records stay unchanged through meta edits', () => {
  const s = seeded()
  archive(s)
  const blob = s.getItem(`nuzlocke.archive.${RUN}`)
  updateArchiveMeta(s, RUN, { title: 'Renamed', status: 'completed', summary: 'Beat it', tracker: {}, archivedAt: 1 })
  assert.equal(s.getItem(`nuzlocke.archive.${RUN}`), blob, 'blob never rewritten')
  const { meta, data } = readArchive(s, RUN)
  assert.equal(meta.title, 'Renamed')
  assert.equal(meta.archivedAt, NOW, 'only title/status/summary are editable')
  assert.deepEqual(data.tracker.__teams, tracker().__teams)
  assert.deepEqual(data.tracker['Route 3'].death, tracker()['Route 3'].death)
})

test('missing metadata is reported as unknown, never estimated', () => {
  const s = new MemoryStorage({
    'nuzlocke.archive': JSON.stringify({ version: 1, attempts: { [RUN]: { name: 'Old' } } }),
    [`nuzlocke.archive.${RUN}`]: JSON.stringify({ tracker: { 'Route 1': { pokemon: 'zubat', status: 1 } } })
  })
  const [a] = listArchives(s)
  assert.equal(a.meta.created, null)
  assert.equal(a.meta.archivedAt, null)
  assert.equal(a.meta.attemptNumber, null)
  assert.equal(a.meta.status, 'archived')
  assert.equal(a.stats.badges, null)
  assert.equal(a.stats.champion, null)
  assert.equal(a.stats.lastSave, null)
  assert.equal(a.stats.deaths, 0)
})

test('summary counts only recorded facts', () => {
  const stats = summarizeAttempt({ tracker: tracker(), unbound: side() })
  assert.deepEqual(stats, {
    encounters: 4,
    available: 2,
    deaths: 1,
    team: ['larvitar', 'zubat'],
    bossFights: 1,
    badges: 3,
    champion: false,
    lastSave: { saveIndex: 100, acceptedAt: 1700000000000 }
  })
})

test('an archive whose blob is missing is listed as missing, not dropped', () => {
  const s = seeded()
  archive(s)
  s.removeItem(`nuzlocke.archive.${RUN}`)
  const [a] = listArchives(s)
  assert.equal(a.missing, true)
  assert.equal(readArchive(s, RUN).data, null)
})

// ---- Sync safety -----------------------------------------------------------------

test('sync may only write to the active, unarchived run', () => {
  const s = seeded()
  assert.equal(isWritableRun(s, RUN), true)
  archive(s)
  assert.equal(isWritableRun(s, RUN), false, 'archived run')
  assert.equal(isWritableRun(s, NEW_RUN), true)
  assert.equal(isWritableRun(s, OTHER_RUN), false, 'not in the run list')
  s.setItem('nuzlocke.archive', '{bad')
  assert.equal(isWritableRun(s, NEW_RUN), false, 'fails closed when history is unreadable')
})

// ---- Per-attempt checklist -----------------------------------------------------

test('checklist completion belongs to one attempt only', () => {
  const s = seeded()
  writeAttempt(s, RUN, setChecked(readAttempt(s, RUN).attempt, 'obj-2', true, 9))
  archive(s)
  assert.deepEqual(readAttempt(s, NEW_RUN).attempt.checklist, {})
  assert.deepEqual(Object.keys(readArchive(s, RUN).data.attempt.checklist).sort(), ['obj-1', 'obj-2'])
  writeAttempt(s, NEW_RUN, setChecked(readAttempt(s, NEW_RUN).attempt, 'obj-1', true, 10))
  writeAttempt(s, NEW_RUN, setChecked(readAttempt(s, NEW_RUN).attempt, 'obj-1', false, 11))
  assert.equal(s.getItem(`nuzlocke.${NEW_RUN}.attempt`), null, 'empty attempt data is not stored')
  assert.ok(readArchive(s, RUN).data.attempt.checklist['obj-1'], 'archive unaffected')
})

// ---- Read-only history UI (structural) -----------------------------------------

test('history pages never import tracker write paths or save sync', () => {
  const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
  const dir = path.join(ROOT, 'src/routes/(app)/history')
  const files = fs.readdirSync(dir, { recursive: true }).filter((f) => f.endsWith('.svelte') || f.endsWith('.js'))
  const detail = files.filter((f) => f.includes('[id]') || f.startsWith('Archived'))
  assert.ok(detail.length, 'detail view exists')
  for (const f of detail) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8')
    for (const banned of ['getGameStore', 'getGame(', 'updatePokemon', 'killPokemon', 'patch(', 'writeSide', 'reconcile', 'pokemon-selector', 'writeAttempt'])
      assert.ok(!src.includes(banned), `${f} must not use ${banned}`)
  }
})

test('recorded boss fights are found in archived attempts without changing them', () => {
  const s = seeded()
  archive(s, { title: 'One' })
  const before = s.dump()
  assert.deepEqual(recordedFights(s, 'r1'), [{ id: RUN, title: 'One', team: ['larvitar'] }])
  assert.deepEqual(recordedFights(s, 'g1'), [])
  assert.deepEqual(recordedFights(s, null), [])
  assert.deepEqual(s.dump(), before)
})
