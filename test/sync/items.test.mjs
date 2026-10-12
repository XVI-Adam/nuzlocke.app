import { test } from 'node:test'
import assert from 'node:assert/strict'

import { readLocal, applyChanges, validateItem, canonical, hashItem, SyncError, KEYCHECK_ID } from '../../src/lib/sync/items.js'
import { isSyncedKey } from '../../src/lib/sync/state.js'
import { archiveAndStartNew, readArchive } from '../../src/lib/history/archive.js'
import { readKnowledge, writeKnowledge, upsert, normalizeKnowledge } from '../../src/lib/history/knowledge.js'
import { parseSaves } from '../../src/lib/history/saves.js'
import { buildBackup } from '../../src/lib/history/backup.js'
import { MemoryStorage, seeded, tracker, RUN, NEW_RUN } from './helpers.mjs'

const NOTE = '30000000-0000-4000-8000-000000000001'

const withNote = (s) => {
  writeKnowledge(s, upsert(normalizeKnowledge(null), 'lessons', { id: NOTE, text: 'Bring a water type' }, 1))
  return s
}

test('local data becomes items: runs, attempt progress, archives, notes - and nothing device-only', () => {
  const s = withNote(seeded())
  archiveAndStartNew(s, { runId: RUN, newRunId: NEW_RUN, now: 10, title: 'Attempt 2' })
  const { items, blocked } = readLocal(s)
  assert.deepEqual(blocked, [])
  assert.deepEqual(Object.keys(items).sort(), [`archive:${RUN}`, `archmeta:${RUN}`, KEYCHECK_ID, `note:lessons:${NOTE}`, `run:${NEW_RUN}`].sort())
  assert.deepEqual(items[`archive:${RUN}`].data.tracker, tracker())
  assert.equal(items[`archmeta:${RUN}`].title, 'Attempt 2')
  assert.equal(items[`archive:${RUN}`].meta.title, undefined, 'editable fields live only in archmeta')
  const all = canonical(items)
  for (const secret of ['secret-key-should-never-be-backed-up', '"dark"']) assert.ok(!all.includes(secret), secret)
})

test('unreadable data is blocked, never reported as deleted', () => {
  const s = withNote(seeded())
  s.setItem(`nuzlocke.${RUN}`, '{not json')
  s.setItem('nuzlocke.knowledge', '{broken')
  const { items, blocked } = readLocal(s)
  assert.ok(!items[`run:${RUN}`])
  assert.ok(blocked.includes(`run:${RUN}`))
  assert.ok(blocked.includes('note:'))
})

test('canonical JSON ignores key order; hashes follow content', async () => {
  assert.equal(canonical({ b: 1, a: [1, { d: 2, c: 3 }] }), canonical({ a: [1, { c: 3, d: 2 }], b: 1 }))
  assert.equal(await hashItem({ a: 1, b: 2 }), await hashItem({ b: 2, a: 1 }))
  assert.notEqual(await hashItem({ a: 1 }), await hashItem({ a: 2 }))
  assert.equal(await hashItem(null), null)
})

test('received items are validated with the backup rules', () => {
  assert.throws(() => validateItem('run:x', { save: { id: 'y', game: 'unbound', created: 1 }, tracker: {} }), SyncError)
  assert.throws(() => validateItem('run:x', { save: { id: 'x', game: '../etc', created: 1 }, tracker: {} }), SyncError)
  assert.throws(() => validateItem('archive:x', { meta: {}, data: { tracker: [] } }), SyncError)
  assert.throws(() => validateItem('note:lessons:x', { id: 'other', text: '' }), SyncError)
  assert.throws(() => validateItem('nuzlocke.theme', {}), SyncError)
  assert.throws(() => validateItem('note:lessons:x', 'text'), SyncError)
  // Links pointing at missing tracker records are dropped, like a .nzsav import
  const v = validateItem(`run:${RUN}`, { save: { id: RUN, name: 'R', game: 'unbound', created: 5 }, tracker: { A: { pokemon: 'zubat' } }, unbound: { baseline: null, links: { '1:2': 'A', '3:4': 'Missing' } } })
  assert.deepEqual(v.unbound.links, { '1:2': 'A' })
})

test('applying items never changes an archived attempt', () => {
  const s = seeded()
  archiveAndStartNew(s, { runId: RUN, newRunId: NEW_RUN, now: 10 })
  const before = s.getItem(`nuzlocke.archive.${RUN}`)
  const archive = readLocal(s).items[`archive:${RUN}`]
  const changed = { ...archive, data: { ...archive.data, tracker: { hacked: { pokemon: 'mew' } } } }
  assert.throws(() => applyChanges(s, [{ id: `archive:${RUN}`, value: changed }]), (e) => e.code === 'archive-immutable')
  assert.equal(s.getItem(`nuzlocke.archive.${RUN}`), before)

  // Run/attempt data for an archived id is refused
  const r = applyChanges(s, [
    { id: `run:${RUN}`, value: { save: { id: RUN, name: 'Zombie', game: 'unbound', created: 1, attempts: 1 }, tracker: {}, unbound: null } },
    { id: `attempt:${RUN}`, value: { notes: 'x', checklist: {} } }
  ])
  assert.deepEqual(r.skipped.map((x) => x.reason), ['archived', 'archived'])
  assert.equal(s.getItem(`nuzlocke.${RUN}`), null)
  assert.ok(!parseSaves(s.getItem('nuzlocke.saves'))[RUN])
  assert.equal(s.getItem(`nuzlocke.archive.${RUN}`), before)
})

test('an archive received for the active run retires it and moves to the next attempt', () => {
  const computer = seeded()
  archiveAndStartNew(computer, { runId: RUN, newRunId: NEW_RUN, now: 10 })
  const items = readLocal(computer).items
  const phone = seeded()
  applyChanges(phone, [
    { id: `archive:${RUN}`, value: items[`archive:${RUN}`] },
    { id: `archmeta:${RUN}`, value: items[`archmeta:${RUN}`] },
    { id: `run:${RUN}`, value: null },
    { id: `run:${NEW_RUN}`, value: items[`run:${NEW_RUN}`] }
  ])
  assert.equal(phone.getItem(`nuzlocke.${RUN}`), null)
  assert.equal(phone.getItem(`nuzlocke.${RUN}.unbound`), null)
  assert.equal(phone.getItem('nuzlocke'), NEW_RUN)
  assert.deepEqual(readArchive(phone, RUN).data, readArchive(computer, RUN).data)
})

test('a failed write leaves everything as it was', () => {
  const s = withNote(seeded())
  const before = s.dump()
  s.failWhen = (key) => key === 'nuzlocke.knowledge'
  const lesson = { ...readKnowledge(s).knowledge.lessons[0], text: 'changed' }
  assert.throws(() => applyChanges(s, [{ id: `note:lessons:${NOTE}`, value: lesson }, { id: `run:${RUN}`, value: null }]))
  s.failWhen = null
  assert.deepEqual(s.dump(), before)
})

test('only tracker data keys trigger a sync; device keys never do', () => {
  for (const k of ['nuzlocke.saves', 'nuzlocke.knowledge', 'nuzlocke.archive', `nuzlocke.archive.${RUN}`, `nuzlocke.${RUN}`, `nuzlocke.${RUN}.unbound`, `nuzlocke.${RUN}.attempt`])
    assert.ok(isSyncedKey(k), k)
  for (const k of ['nuzlocke.theme', 'nuzlocke.user', 'nuzlocke.consent', 'nuzlocke.sync', 'nuzlocke.sync.base', 'nuzlocke.unbound.syncKey', 'other'])
    assert.ok(!isSyncedKey(k), k)
})

test('backups never include sync credentials', () => {
  const s = seeded()
  s.setItem('nuzlocke.sync', JSON.stringify({ token: 'TOKEN-SHOULD-NOT-LEAK', key: 'KEY-SHOULD-NOT-LEAK' }))
  const text = JSON.stringify(buildBackup(s, 1).backup)
  assert.ok(!text.includes('SHOULD-NOT-LEAK'))
})

test('an empty device has only the key check item', () => {
  assert.deepEqual(Object.keys(readLocal(new MemoryStorage()).items), [KEYCHECK_ID])
})
