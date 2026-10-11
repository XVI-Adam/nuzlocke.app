import { test } from 'node:test'
import assert from 'node:assert/strict'

import { buildBackup, validateBackup, planRestore, applyRestore, parseBackupText, BackupError } from '../../src/lib/history/backup.js'
import { archiveAndStartNew, readArchive, listArchives } from '../../src/lib/history/archive.js'
import { readKnowledge, writeKnowledge, upsert, normalizeKnowledge } from '../../src/lib/history/knowledge.js'
import { readAttempt } from '../../src/lib/history/attempt.js'
import { parseSaves } from '../../src/lib/history/saves.js'
import { MemoryStorage, seeded, tracker, side, RUN, NEW_RUN, OT } from './helpers.mjs'

const K1 = '20000000-0000-4000-8000-000000000001'
const K2 = '20000000-0000-4000-8000-000000000002'

/** Computer: attempt 2 archived, attempt 3 active, some notes */
const computer = () => {
  const s = seeded()
  writeKnowledge(s, upsert(normalizeKnowledge(null), 'bosses', { id: K1, game: 'unbound', ref: 'r1', name: 'Rival', strategy: 'Water lead' }, 1))
  archiveAndStartNew(s, { runId: RUN, newRunId: NEW_RUN, now: 10, title: 'Attempt 2', status: 'lost' })
  s.setItem(`nuzlocke.${NEW_RUN}`, JSON.stringify({ 'Route 1': { id: 2, pokemon: 'zubat', status: 1, location: 'Route 1' } }))
  s.setItem(`nuzlocke.${NEW_RUN}.unbound`, JSON.stringify({ ...side(), links: { [`${OT}:11`]: 'Route 1' }, facts: {} }))
  return s
}

const roundTrip = (s) => parseBackupText(JSON.stringify(buildBackup(s, 99).backup))

test('a backup holds runs, archives, notes and Unbound state - and no secrets', () => {
  const s = computer()
  const { backup, skipped } = buildBackup(s, 99)
  assert.deepEqual(skipped, [])
  assert.equal(backup.active, NEW_RUN)
  assert.deepEqual(backup.runs.map((r) => r.save.id), [NEW_RUN])
  assert.equal(backup.runs[0].unbound.baseline.snapshot.boxes.length, 25)
  assert.deepEqual(backup.archives.map((a) => a.meta.id), [RUN])
  assert.deepEqual(backup.archives[0].data.tracker, tracker())
  assert.equal(backup.knowledge.bosses[0].strategy, 'Water lead')
  const text = JSON.stringify(backup)
  assert.ok(!text.includes('secret-key'), 'sync key never exported')
  assert.ok(!text.includes('"dark"'), 'theme not exported')
})

test('restoring onto an empty phone recreates everything with the same ids', () => {
  const { backup, warnings } = roundTrip(computer())
  assert.deepEqual(warnings, [])
  const phone = new MemoryStorage()
  const plan = planRestore(phone, backup)
  assert.ok(plan.items.every((i) => i.state === 'new'))
  const result = applyRestore(phone, backup, {}, { switchActive: true })
  assert.deepEqual(result, { runs: 1, archives: 1, knowledge: 1, active: NEW_RUN })

  const src = computer()
  for (const key of [`nuzlocke.${NEW_RUN}`, `nuzlocke.archive.${RUN}`]) assert.deepEqual(JSON.parse(phone.getItem(key)), JSON.parse(src.getItem(key)), key)
  assert.deepEqual(JSON.parse(phone.getItem(`nuzlocke.${NEW_RUN}.unbound`)).links, { [`${OT}:11`]: 'Route 1' })
  assert.equal(phone.getItem('nuzlocke'), NEW_RUN)
  assert.equal(parseSaves(phone.getItem('nuzlocke.saves'))[NEW_RUN].name, 'Unbound Run')
  assert.equal(listArchives(phone)[0].meta.title, 'Attempt 2')
  assert.equal(readKnowledge(phone).knowledge.bosses[0].id, K1)
})

test('restoring the same backup twice changes nothing', () => {
  const s = computer()
  const { backup } = roundTrip(s)
  const before = s.dump()
  assert.ok(planRestore(s, backup).items.every((i) => i.state === 'same'))
  applyRestore(s, backup)
  assert.deepEqual(s.dump(), before)
})

test('conflicts are surfaced and default to keeping this device', () => {
  const phone = computer()
  const { backup } = roundTrip(computer())
  // The phone played on, and edited a note
  phone.setItem(`nuzlocke.${NEW_RUN}`, JSON.stringify({ 'Route 1': { id: 2, pokemon: 'golbat', status: 1, location: 'Route 1' } }))
  writeKnowledge(phone, upsert(readKnowledge(phone).knowledge, 'bosses', { id: K1, strategy: 'Grass lead' }, 50))
  const phoneState = phone.dump()

  const { items } = planRestore(phone, backup)
  const conflicts = items.filter((i) => i.state === 'conflict')
  assert.deepEqual(conflicts.map((i) => i.key).sort(), [`bosses:${K1}`, `run:${NEW_RUN}`])
  assert.ok(conflicts.every((i) => i.default === 'keep'))

  applyRestore(phone, backup) // all defaults
  assert.deepEqual(phone.dump(), phoneState, 'nothing overwritten without a choice')

  applyRestore(phone, backup, { [`run:${NEW_RUN}`]: 'replace' })
  assert.equal(JSON.parse(phone.getItem(`nuzlocke.${NEW_RUN}`))['Route 1'].pokemon, 'zubat')
  assert.equal(readKnowledge(phone).knowledge.bosses[0].strategy, 'Grass lead', 'note kept')
})

test('a run archived on the other device can retire the local active copy, only when chosen', () => {
  // Phone still has attempt 2 active; computer archived it
  const phone = seeded()
  const { backup } = roundTrip(computer())
  const item = planRestore(phone, backup).items.find((i) => i.key === `archive:${RUN}`)
  assert.equal(item.state, 'conflict')
  assert.equal(item.default, 'keep')

  applyRestore(phone, backup, { [`run:${NEW_RUN}`]: 'add' })
  assert.ok(phone.getItem(`nuzlocke.${RUN}`), 'kept by default')
  assert.equal(readArchive(phone, RUN), null)

  applyRestore(phone, backup, { [`archive:${RUN}`]: 'replace' }, { switchActive: true })
  assert.equal(phone.getItem(`nuzlocke.${RUN}`), null)
  assert.equal(phone.getItem(`nuzlocke.${RUN}.unbound`), null)
  assert.deepEqual(readArchive(phone, RUN).data.tracker, tracker())
  assert.equal(phone.getItem('nuzlocke'), NEW_RUN)
})

test('an attempt archived on this device is never revived as active by a backup', () => {
  const s = computer()
  const old = seeded() // a backup from before the archive
  const { backup } = roundTrip(old)
  const item = planRestore(s, backup).items.find((i) => i.key === `run:${RUN}`)
  assert.deepEqual(item.choices, ['keep'])
  applyRestore(s, backup, { [`run:${RUN}`]: 'replace' })
  assert.equal(s.getItem(`nuzlocke.${RUN}`), null)
})

test('new items can be skipped', () => {
  const { backup } = roundTrip(computer())
  const phone = new MemoryStorage()
  applyRestore(phone, backup, { [`archive:${RUN}`]: 'skip', [`bosses:${K1}`]: 'skip' })
  assert.equal(phone.getItem('nuzlocke.archive'), null)
  assert.equal(phone.getItem('nuzlocke.knowledge'), null)
  assert.ok(phone.getItem(`nuzlocke.${NEW_RUN}`))
})

test('a failed restore leaves the device unchanged', () => {
  const { backup } = roundTrip(computer())
  const phone = seeded()
  const before = phone.dump()
  phone.failWhen = (key) => key === 'nuzlocke.knowledge'
  assert.throws(() => applyRestore(phone, backup, { [`archive:${RUN}`]: 'replace' }), /storage is full/i)
  assert.deepEqual(phone.dump(), before)
})

test('invalid files are rejected before anything is applied', () => {
  for (const bad of ['not json', '{}', '{"format":"nuzlocke-backup"}', '{"format":"nuzlocke-backup","version":99}', '[]'])
    assert.throws(() => parseBackupText(bad), BackupError, bad)
})

test('bad items are dropped with warnings; Unbound links are validated', () => {
  const { backup: good } = buildBackup(computer(), 1)
  const file = JSON.parse(JSON.stringify(good))
  file.runs.push({ save: { id: 'bad|id', name: 'x', game: 'unbound', created: 1 }, tracker: {} })
  file.runs.push({ save: { id: K2, name: 'No tracker', game: 'unbound', created: 1 }, tracker: 'nope' })
  file.runs[0].unbound.links['1:2'] = 'Missing route'
  file.archives.push({ meta: { id: '../evil' }, data: { tracker: {} } })
  file.knowledge.lessons = [{ id: 'x y', text: 'bad' }]
  const { backup, warnings } = validateBackup(file)
  assert.deepEqual(backup.runs.map((r) => r.save.id), [NEW_RUN])
  assert.deepEqual(Object.keys(backup.runs[0].unbound.links), [`${OT}:11`])
  assert.equal(backup.archives.length, 1)
  assert.equal(backup.knowledge.lessons.length, 0)
  assert.equal(warnings.length, 4)
})

test('unreadable local data is reported in the backup, not silently dropped', () => {
  const s = computer()
  s.setItem(`nuzlocke.${NEW_RUN}`, '{bad')
  const { backup, skipped } = buildBackup(s, 1)
  assert.equal(backup.runs.length, 0)
  assert.equal(skipped[0].kind, 'run')
})

test('restore refuses to merge into unreadable local notes or history', () => {
  const { backup } = roundTrip(computer())
  const phone = new MemoryStorage({ 'nuzlocke.knowledge': '{bad' })
  assert.throws(() => planRestore(phone, backup), BackupError)
  const phone2 = new MemoryStorage({ 'nuzlocke.archive': '{bad' })
  assert.throws(() => applyRestore(phone2, backup))
  assert.equal(phone2.getItem('nuzlocke.archive'), '{bad')
})

test('attempt notes travel with their run', () => {
  const s = seeded()
  const { backup } = roundTrip(s)
  const phone = new MemoryStorage()
  applyRestore(phone, backup)
  assert.equal(readAttempt(phone, RUN).attempt.notes, 'Lost to the crit')
})
