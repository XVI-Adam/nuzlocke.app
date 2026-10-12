import { test } from 'node:test'
import assert from 'node:assert/strict'

import { beginConnect, previewConnect, completeConnect, createPairingCode, recoveryKeyFor, disconnect, provideRecoveryKey } from '../../src/lib/sync/device.js'
import { readLocal } from '../../src/lib/sync/items.js'
import { planIncoming, planOutgoing, conflictChoices } from '../../src/lib/sync/engine.js'
import { createApi } from '../../src/lib/sync/api.js'
import { encodeRecoveryKey, generateKeyBytes } from '../../src/lib/sync/crypto.js'
import { archiveAndStartNew, deleteArchive, readArchive, updateArchiveMeta } from '../../src/lib/history/archive.js'
import { readKnowledge, writeKnowledge, upsert, remove } from '../../src/lib/history/knowledge.js'
import { parseSaves, formatSaves } from '../../src/lib/history/saves.js'
import { createServer, device, MemoryStorage, seeded, tracker, RUN, NEW_RUN, SETUP_KEY } from './helpers.mjs'

const N1 = '40000000-0000-4000-8000-000000000001'
const N2 = '40000000-0000-4000-8000-000000000002'

const addNote = (s, id, text, now = 1) => writeKnowledge(s, upsert(readKnowledge(s).knowledge, 'lessons', { id, text }, now))
const noteText = (s, id) => readKnowledge(s).knowledge.lessons.find((l) => l.id === id)?.text
const setTracker = (s, id, t) => s.setItem(`nuzlocke.${id}`, JSON.stringify(t))

/** Synced data only (device settings and sync bookkeeping excluded) */
const syncedKeys = (s) =>
  Object.fromEntries(Object.entries(s.dump()).filter(([k]) => !k.startsWith('nuzlocke.sync') && !['nuzlocke.theme', 'nuzlocke.user', 'nuzlocke.unbound.syncKey'].includes(k)))

/** A computer with a run, an archive and a note, connected as the first device; and a paired phone */
async function pair({ phoneStorage = new MemoryStorage(), server = createServer() } = {}) {
  const cs = seeded()
  addNote(cs, N1, 'Bring a water type')
  archiveAndStartNew(cs, { runId: RUN, newRunId: NEW_RUN, now: 10, title: 'Attempt 2', status: 'lost' })
  setTracker(cs, NEW_RUN, { 'Route 1': { id: 2, pokemon: 'zubat', status: 1, location: 'Route 1' } })
  const computer = device(server, cs)
  await computer.connectNew('Computer')

  const { code } = await createPairingCode(cs, computer.opts)
  await beginConnect(phoneStorage, { method: 'pairing', pairingCode: code, name: 'iPhone' }, computer.opts)
  const phone = device(server, phoneStorage)
  return { server, computer, phone, preview: await previewConnect(phoneStorage, phone.opts) }
}

test('first device: preview lists uploads, then only ciphertext reaches the server', async () => {
  const server = createServer()
  const s = seeded()
  addNote(s, N1, 'Bring a water type')
  const before = syncedKeys(s)
  await beginConnect(s, { method: 'setup', setupKey: SETUP_KEY, name: 'Computer' }, { fetch: server.fetch })
  const preview = await previewConnect(s, { fetch: server.fetch })
  assert.deepEqual(preview.download, [])
  assert.deepEqual(preview.upload.map((u) => u.id).sort(), [`attempt:${RUN}`, `note:lessons:${N1}`, `run:${RUN}`].sort())
  assert.equal(preview.remoteInitialized, false)
  assert.equal(server.store._dump().ct.size, 0, 'a preview writes nothing to the server')
  assert.deepEqual(syncedKeys(s), before, 'or locally')

  await completeConnect(s, {}, { fetch: server.fetch })
  assert.equal(JSON.parse(s.getItem('nuzlocke.sync')).connected, true)
  const stored = [...server.store._dump().ct.values()].join('\n')
  for (const secret of ['Unbound Run', 'Rocky', 'larvitar', 'Bring a water', 'TEST', 'secret-key-should-never-be-backed-up']) assert.ok(!stored.includes(secret), secret)
  const wire = server.requests.map((r) => r.body + JSON.stringify(r.headers) + r.url).join('\n')
  assert.ok(!wire.includes(JSON.parse(s.getItem('nuzlocke.sync')).key), 'the encryption key never leaves the device')
  for (const r of server.requests) assert.ok(!/token|key|Bearer/i.test(r.url))
  assert.deepEqual(server.logs, [])
})

test('empty phone: pairing previews downloads, writes nothing until confirmed, then mirrors the computer', async () => {
  const phoneStorage = new MemoryStorage({ 'nuzlocke.theme': 'light' })
  const { computer, phone, preview } = await pair({ phoneStorage })
  assert.deepEqual(preview.upload, [])
  assert.ok(preview.download.some((d) => d.id === `archive:${RUN}`))
  assert.equal(preview.conflicts.length, 0)
  assert.equal(phoneStorage.getItem('nuzlocke.saves'), null, 'nothing written before confirming')

  await completeConnect(phoneStorage, {}, phone.opts)
  const c = syncedKeys(computer.storage)
  const p = syncedKeys(phoneStorage)
  assert.deepEqual(Object.keys(p).sort(), Object.keys(c).sort())
  for (const k of Object.keys(c)) assert.deepEqual(JSON.parse(p[k].startsWith('{') ? p[k] : JSON.stringify(p[k])), JSON.parse(c[k].startsWith('{') ? c[k] : JSON.stringify(c[k])), k)
  assert.equal(phoneStorage.getItem('nuzlocke.theme'), 'light', 'theme stays per device')
  assert.equal(phoneStorage.getItem('nuzlocke.unbound.syncKey'), null, 'Unbound key never synced')
  assert.equal(phoneStorage.getItem('nuzlocke'), NEW_RUN)
})

test('existing data on both devices: identical items match, differences need a choice, nothing is replaced silently', async () => {
  const server = createServer()
  const cs = seeded()
  addNote(cs, N1, 'Computer version')
  const computer = device(server, cs)
  await computer.connectNew()

  const ps = seeded() // same run (same ids) from an earlier backup restore
  addNote(ps, N1, 'Phone version')
  addNote(ps, N2, 'Only on the phone')
  const rk = await recoveryKeyFor(cs)
  assert.deepEqual(await beginConnect(ps, { method: 'setup', setupKey: SETUP_KEY, name: 'iPhone' }, computer.opts), { needsKey: true, newDataset: false })
  await provideRecoveryKey(ps, rk)
  const before = syncedKeys(ps)
  const preview = await previewConnect(ps, computer.opts)
  assert.deepEqual(preview.conflicts.map((c) => c.id), [`note:lessons:${N1}`])
  assert.deepEqual(preview.upload.map((u) => u.id), [`note:lessons:${N2}`])
  assert.ok(preview.same >= 2, 'run and attempt are identical')

  // Confirm without deciding: the conflict stays open, nothing overwritten
  await completeConnect(ps, {}, computer.opts)
  assert.equal(noteText(ps, N1), 'Phone version')
  assert.deepEqual(readKnowledge(ps).knowledge.lessons.length, 2)
  assert.equal(JSON.parse(ps.getItem('nuzlocke.sync.conflicts')).length, 1)
  assert.deepEqual(syncedKeys(ps)[`nuzlocke.${RUN}`], before[`nuzlocke.${RUN}`])

  await computer.sync()
  assert.equal(noteText(cs, N1), 'Computer version', 'the computer was not overwritten either')
  assert.equal(noteText(cs, N2), 'Only on the phone')

  // Choose: keep the phone's
  const phone = device(server, ps)
  await phone.sync({ decisions: { [`note:lessons:${N1}`]: 'local' } })
  await computer.sync()
  assert.equal(noteText(cs, N1), 'Phone version')
  assert.equal(phone.state().conflicts.length, 0)
})

test('a wrong recovery key fails before anything is written', async () => {
  const server = createServer()
  const computer = device(server, seeded())
  await computer.connectNew()
  const ps = seeded()
  await beginConnect(ps, { method: 'setup', setupKey: SETUP_KEY, name: 'iPhone' }, computer.opts)
  await provideRecoveryKey(ps, await encodeRecoveryKey(generateKeyBytes()))
  const before = ps.dump()
  await assert.rejects(previewConnect(ps, computer.opts), (e) => e.code === 'wrong-key')
  await assert.rejects(completeConnect(ps, {}, computer.opts), (e) => e.code === 'wrong-key')
  assert.deepEqual(ps.dump(), before)
})

test('a change on one device appears on the other', async () => {
  const { computer, phone } = await pair()
  await completeConnect(phone.storage, {}, phone.opts)
  addNote(computer.storage, N2, 'New lesson')
  setTracker(computer.storage, NEW_RUN, { ...tracker(), 'Route 9': { id: 9, pokemon: 'eevee', status: 1, location: 'Route 9' } })
  await computer.sync()
  const res = await phone.sync()
  assert.ok(res.applied.includes(`note:lessons:${N2}`))
  assert.equal(noteText(phone.storage, N2), 'New lesson')
  assert.equal(JSON.parse(phone.storage.getItem(`nuzlocke.${NEW_RUN}`))['Route 9'].pokemon, 'eevee')
  // Nothing left to do on either side
  assert.equal((await phone.sync()).uploaded, 0)
  assert.equal((await computer.sync()).applied.length, 0)
})

test('just opening the game on both devices (last-played time) is not a conflict', async () => {
  const { computer, phone } = await pair()
  await completeConnect(phone.storage, {}, phone.opts)
  const touch = (s, t) => {
    const saves = parseSaves(s.getItem('nuzlocke.saves'))
    saves[NEW_RUN] = { ...saves[NEW_RUN], updated: String(t) }
    s.setItem('nuzlocke.saves', formatSaves(saves))
  }
  touch(computer.storage, 1800000000000)
  setTracker(computer.storage, NEW_RUN, { 'Route 5': { id: 5, pokemon: 'geodude', status: 1, location: 'Route 5' } })
  touch(phone.storage, 1800000000500)
  await computer.sync()
  const res = await phone.sync()
  assert.deepEqual(res.conflicts, [])
  assert.equal(JSON.parse(phone.storage.getItem(`nuzlocke.${NEW_RUN}`))['Route 5'].pokemon, 'geodude')
})

test('concurrent edits: the stale write is rejected and becomes a conflict for that note only', async () => {
  const { server, computer, phone } = await pair()
  await completeConnect(phone.storage, {}, phone.opts)
  addNote(computer.storage, N1, 'Computer edit', 5)
  addNote(phone.storage, N1, 'Phone edit', 6)
  addNote(phone.storage, N2, 'Unrelated phone note', 6)
  await computer.sync()
  const revBefore = server.store._dump().meta.rev

  const res = await phone.sync()
  assert.deepEqual(res.conflicts.map((c) => c.id), [`note:lessons:${N1}`])
  assert.equal(noteText(phone.storage, N1), 'Phone edit', 'local edit kept while unresolved')
  assert.equal(server.store._dump().meta.rev, revBefore + 1, 'only the unrelated note was uploaded')
  await computer.sync()
  assert.equal(noteText(computer.storage, N1), 'Computer edit')
  assert.equal(noteText(computer.storage, N2), 'Unrelated phone note')

  assert.deepEqual(conflictChoices(res.conflicts[0], readLocal(phone.storage)), ['local', 'remote'])
  await phone.sync({ decisions: { [`note:lessons:${N1}`]: 'remote' } })
  assert.equal(noteText(phone.storage, N1), 'Computer edit')
  assert.equal(phone.state().conflicts.length, 0)
})

test('the server rejects a write based on an old revision', async () => {
  const { server, computer } = await pair()
  const api = createApi({ token: computer.state().config.token, fetch: server.fetch })
  const { epoch } = computer.state().config
  const base = computer.state().base[`note:lessons:${N1}`].rev
  const ct = (await api.pull({ since: 0 })).items.find((i) => i.id === `note:lessons:${N1}`).ct
  assert.equal((await api.push({ epoch, items: [{ id: `note:lessons:${N1}`, base, ct }] })).ok, true)
  const stale = await api.push({ epoch, items: [{ id: `note:lessons:${N1}`, base, ct }] })
  assert.deepEqual(stale, { conflict: true, ids: [`note:lessons:${N1}`] })
  await assert.rejects(api.push({ epoch: 'x'.repeat(24), items: [{ id: `note:lessons:${N1}`, base: 0, ct }] }), (e) => e.code === 'epoch')
})

test('deleted notes and archives stay deleted when a stale device reconnects', async () => {
  const { computer, phone } = await pair()
  await completeConnect(phone.storage, {}, phone.opts)
  // The phone is put away for a while; the computer deletes things
  writeKnowledge(computer.storage, remove(readKnowledge(computer.storage).knowledge, 'lessons', N1))
  deleteArchive(computer.storage, RUN)
  await computer.sync()

  const res = await phone.sync()
  assert.deepEqual(res.conflicts, [])
  assert.equal(noteText(phone.storage, N1), undefined)
  assert.equal(readArchive(phone.storage, RUN), null)
  assert.equal(phone.storage.getItem(`nuzlocke.archive.${RUN}`), null)
  await computer.sync()
  assert.equal(noteText(computer.storage, N1), undefined, 'nothing came back')
  assert.equal(readArchive(computer.storage, RUN), null)
})

test('a stale device that edited a deleted note is asked, never silently resurrects it', async () => {
  const { computer, phone } = await pair()
  await completeConnect(phone.storage, {}, phone.opts)
  writeKnowledge(computer.storage, remove(readKnowledge(computer.storage).knowledge, 'lessons', N1))
  await computer.sync()
  addNote(phone.storage, N1, 'Edited offline', 9)
  const res = await phone.sync()
  assert.equal(res.conflicts[0].id, `note:lessons:${N1}`)
  assert.equal(res.conflicts[0].remote, null)
  await computer.sync()
  assert.equal(noteText(computer.storage, N1), undefined)
  await phone.sync({ decisions: { [`note:lessons:${N1}`]: 'local' } }) // restore it
  await computer.sync()
  assert.equal(noteText(computer.storage, N1), 'Edited offline')
})

test('archiving on one device retires the run on the other; archive data is identical and immutable', async () => {
  const server = createServer()
  const cs = seeded()
  const computer = device(server, cs)
  await computer.connectNew()
  const { code } = await createPairingCode(cs, computer.opts)
  const ps = new MemoryStorage()
  await beginConnect(ps, { method: 'pairing', pairingCode: code, name: 'iPhone' }, computer.opts)
  await completeConnect(ps, {}, computer.opts)
  const phone = device(server, ps)
  assert.equal(ps.getItem('nuzlocke'), RUN)

  archiveAndStartNew(cs, { runId: RUN, newRunId: NEW_RUN, now: 20, title: 'Lost to Mirskle' })
  await computer.sync()
  await phone.sync()
  assert.equal(ps.getItem(`nuzlocke.${RUN}`), null)
  assert.equal(ps.getItem('nuzlocke'), NEW_RUN)
  assert.deepEqual(readArchive(ps, RUN), readArchive(cs, RUN))
  const archived = cs.getItem(`nuzlocke.archive.${RUN}`)

  // Title edits sync; the archived data never changes
  updateArchiveMeta(ps, RUN, { title: 'Renamed', status: 'completed', tracker: { evil: 1 } })
  await phone.sync()
  await computer.sync()
  assert.equal(readArchive(cs, RUN).meta.title, 'Renamed')
  assert.equal(readArchive(cs, RUN).meta.status, 'completed')
  assert.equal(cs.getItem(`nuzlocke.archive.${RUN}`), archived)

  // The server refuses to replace an archive even with the right revision
  const api = createApi({ token: phone.state().config.token, fetch: server.fetch })
  const live = (await api.pull({ since: 0 })).items.find((i) => i.id === `archive:${RUN}`)
  const res = await api.push({ epoch: phone.state().config.epoch, items: [{ id: `archive:${RUN}`, base: live.rev, ct: live.ct }] })
  assert.equal(res.conflict, true)
})

test('archived elsewhere while edited here: the archive waits and the edits can be kept as a copy', async () => {
  const server = createServer()
  const cs = seeded()
  const computer = device(server, cs)
  await computer.connectNew()
  const { code } = await createPairingCode(cs, computer.opts)
  const ps = new MemoryStorage()
  await beginConnect(ps, { method: 'pairing', pairingCode: code, name: 'iPhone' }, computer.opts)
  await completeConnect(ps, {}, computer.opts)
  const phone = device(server, ps)

  archiveAndStartNew(cs, { runId: RUN, newRunId: NEW_RUN, now: 20 })
  await computer.sync()
  const edited = { ...tracker(), 'Route 7': { id: 7, pokemon: 'ralts', status: 1, location: 'Route 7' } }
  setTracker(ps, RUN, edited)

  const res = await phone.sync()
  const c = res.conflicts.find((x) => x.id === `run:${RUN}`)
  assert.equal(c.reason, 'archived-elsewhere')
  assert.deepEqual(conflictChoices(c, readLocal(ps)), ['remote', 'copy'])
  assert.deepEqual(JSON.parse(ps.getItem(`nuzlocke.${RUN}`)), edited, 'edits untouched while unresolved')
  assert.equal(readArchive(ps, RUN), null, 'archive held back')

  await phone.sync({ decisions: { [`run:${RUN}`]: 'copy' } })
  assert.equal(ps.getItem(`nuzlocke.${RUN}`), null)
  assert.deepEqual(readArchive(ps, RUN).data, readArchive(cs, RUN).data)
  const copy = Object.values(parseSaves(ps.getItem('nuzlocke.saves'))).find((r) => r.name.endsWith('(copy)'))
  assert.ok(copy)
  assert.deepEqual(JSON.parse(ps.getItem(`nuzlocke.${copy.id}`)), edited)
  await computer.sync()
  assert.deepEqual(JSON.parse(cs.getItem(`nuzlocke.${copy.id}`)), edited)
  assert.equal(cs.getItem(`nuzlocke.${RUN}`), null, 'the archived run is not revived')
})

test('two devices archiving the same run: neither archive is overwritten', async () => {
  const server = createServer()
  const cs = seeded()
  const computer = device(server, cs)
  await computer.connectNew()
  const { code } = await createPairingCode(cs, computer.opts)
  const ps = new MemoryStorage()
  await beginConnect(ps, { method: 'pairing', pairingCode: code, name: 'iPhone' }, computer.opts)
  await completeConnect(ps, {}, computer.opts)
  const phone = device(server, ps)

  archiveAndStartNew(cs, { runId: RUN, newRunId: NEW_RUN, now: 20 })
  setTracker(ps, RUN, { ...tracker(), extra: { pokemon: 'mew', status: 1 } })
  archiveAndStartNew(ps, { runId: RUN, newRunId: '99999999-0000-4000-8000-000000000009', now: 21 })
  const phoneArchive = ps.getItem(`nuzlocke.archive.${RUN}`)
  await computer.sync()
  const res = await phone.sync()
  const c = res.conflicts.find((x) => x.id === `archive:${RUN}`)
  assert.equal(c.reason, 'archive-differs')
  assert.deepEqual(conflictChoices(c, readLocal(ps)), ['copy'])
  assert.equal(ps.getItem(`nuzlocke.archive.${RUN}`), phoneArchive)

  await phone.sync({ decisions: { [`archive:${RUN}`]: 'copy' } })
  assert.deepEqual(readArchive(ps, RUN).data, readArchive(cs, RUN).data)
  const copies = Object.values(JSON.parse(ps.getItem('nuzlocke.archive')).attempts).filter((m) => m.id !== RUN)
  assert.equal(copies.length, 1)
  assert.equal(ps.getItem(`nuzlocke.archive.${copies[0].id}`), phoneArchive, 'this device’s archive kept byte for byte')
})

test('an archive replaced locally by a backup restore never syncs over the original and is surfaced', async () => {
  const { server, computer, phone } = await pair()
  await completeConnect(phone.storage, {}, phone.opts)
  const original = computer.storage.getItem(`nuzlocke.archive.${RUN}`)
  // Phase 5 restore with "use the backup's copy" for a differing archive
  const replaced = { ...JSON.parse(original), tracker: { other: { pokemon: 'mew', status: 1 } } }
  phone.storage.setItem(`nuzlocke.archive.${RUN}`, JSON.stringify(replaced))
  const rev = server.store._dump().meta.rev

  const res = await phone.sync()
  assert.equal(server.store._dump().meta.rev, rev, 'nothing uploaded')
  const c = res.conflicts.find((x) => x.id === `archive:${RUN}`)
  assert.equal(c.reason, 'archive-differs')
  assert.deepEqual(conflictChoices(c, readLocal(phone.storage)), ['copy'])

  await phone.sync({ decisions: { [`archive:${RUN}`]: 'copy' } })
  assert.equal(phone.storage.getItem(`nuzlocke.archive.${RUN}`), original)
  const copy = Object.values(JSON.parse(phone.storage.getItem('nuzlocke.archive')).attempts).find((m) => m.id !== RUN)
  assert.deepEqual(JSON.parse(phone.storage.getItem(`nuzlocke.archive.${copy.id}`)).tracker, replaced.tracker)
  await computer.sync()
  assert.equal(computer.storage.getItem(`nuzlocke.archive.${RUN}`), original, 'the synced archive never changed')
})

test('offline edits sync after reconnecting; a lost response is not applied twice', async () => {
  const { server, computer, phone } = await pair()
  await completeConnect(phone.storage, {}, phone.opts)
  server.net.offline = true
  addNote(phone.storage, N2, 'Written offline')
  await assert.rejects(phone.sync(), (e) => e.code === 'offline')
  server.net.offline = false

  const rev = server.store._dump().meta.rev
  server.net.dropResponseNext = 1 // the push lands but its reply is lost; retried with the same request id
  await phone.sync()
  assert.equal(server.store._dump().meta.rev, rev + 1, 'one revision only')
  await computer.sync()
  assert.equal(noteText(computer.storage, N2), 'Written offline')
})

test('a reply lost twice: the next sync recognises its own upload', async () => {
  const { server, computer, phone } = await pair()
  await completeConnect(phone.storage, {}, phone.opts)
  addNote(phone.storage, N2, 'Hello')
  server.net.dropResponseNext = 2
  await assert.rejects(phone.sync(), (e) => e.code === 'offline')
  const res = await phone.sync()
  assert.equal(res.conflicts.length, 0)
  assert.equal(res.uploaded, 0)
  await computer.sync()
  assert.equal(noteText(computer.storage, N2), 'Hello')
})

test('server or storage failures change nothing and can be retried', async () => {
  const { server, computer, phone } = await pair()
  await completeConnect(phone.storage, {}, phone.opts)
  addNote(computer.storage, N2, 'From computer')
  await computer.sync()

  // Phone storage full while applying: nothing partial, base untouched
  const base = JSON.stringify(phone.state().base)
  const before = phone.storage.getItem('nuzlocke.knowledge')
  phone.storage.failWhen = (key) => key === 'nuzlocke.knowledge'
  await assert.rejects(phone.sync(), (e) => e.name === 'StorageError')
  phone.storage.failWhen = null
  assert.equal(phone.storage.getItem('nuzlocke.knowledge'), before)
  assert.equal(JSON.stringify(phone.state().base), base)

  // Server storage down
  server.store.failures.next = 1
  await assert.rejects(phone.sync(), (e) => e.code === 'storage-error')

  // Upload fails twice (the retry too): nothing is marked as synced
  const N3 = '40000000-0000-4000-8000-000000000003'
  server.net.failOp = 'push'
  server.net.failNext = 2
  addNote(phone.storage, N3, 'x')
  await assert.rejects(phone.sync(), (e) => e.code === 'storage-error')
  server.net.failOp = null
  assert.ok(!phone.state().base[`note:lessons:${N3}`])

  await phone.sync()
  await computer.sync()
  assert.equal(noteText(phone.storage, N2), 'From computer')
  assert.equal(noteText(computer.storage, N3), 'x')
})

test('tampered or swapped server data is refused and nothing is written', async () => {
  const { server, computer, phone } = await pair()
  await completeConnect(phone.storage, {}, phone.opts)
  addNote(computer.storage, N1, 'Changed', 7)
  await computer.sync()
  // A malicious server moves another item's ciphertext under this note's id
  const ct = server.store._dump().ct
  const other = [...ct.entries()].find(([k, v]) => k.startsWith('run:') && v)[1]
  server.store._set(`note:lessons:${N1}`, other)
  const before = phone.storage.dump()
  await assert.rejects(phone.sync(), (e) => e.code === 'decrypt-failed')
  assert.deepEqual(phone.storage.dump(), before)
})

test('revoked devices can no longer sync, and keep their local data', async () => {
  const { computer, phone } = await pair()
  await completeConnect(phone.storage, {}, phone.opts)
  const api = createApi({ token: computer.state().config.token, fetch: computer.opts.fetch })
  const { devices } = await api.devices()
  assert.equal(devices.length, 2)
  const iphone = devices.find((d) => d.name === 'iPhone')
  assert.equal((await api.revoke(iphone.id)).revoked, true)
  const before = syncedKeys(phone.storage)
  await assert.rejects(phone.sync(), (e) => e.code === 'unauthorized')
  assert.deepEqual(syncedKeys(phone.storage), before)
  // The computer is unaffected
  await computer.sync()
  // A pairing code is single-use
  const { code } = await createPairingCode(computer.storage, computer.opts)
  await beginConnect(new MemoryStorage(), { method: 'pairing', pairingCode: code, name: 'A' }, computer.opts)
  await assert.rejects(beginConnect(new MemoryStorage(), { method: 'pairing', pairingCode: code, name: 'B' }, computer.opts), (e) => e.code === 'bad-pairing')
  await disconnect(phone.storage, phone.opts)
  assert.equal(phone.storage.getItem('nuzlocke.sync'), null)
  assert.deepEqual(syncedKeys(phone.storage), before)
})

test('planning: local deletions become tombstones, unreadable data is never touched', () => {
  const local = { items: { 'note:lessons:a': { x: 1 } }, blocked: ['note:lessons:b', 'archive:'] }
  const localHashes = { 'note:lessons:a': 'h1' }
  const base = { 'note:lessons:a': { rev: 1, hash: 'h0' }, 'note:lessons:c': { rev: 2, hash: 'h2' }, 'note:lessons:b': { rev: 3, hash: 'h3' }, 'archive:z': { rev: 4, hash: 'h4' } }
  assert.deepEqual(
    planOutgoing({ local, localHashes, base }).map((o) => [o.id, o.base, o.value]),
    [
      ['note:lessons:a', 1, { x: 1 }],
      ['note:lessons:c', 2, null]
    ]
  )
  const plan = planIncoming({ remote: [{ id: 'note:lessons:b', rev: 9, value: { y: 1 }, hash: 'hb' }], base, local, localHashes })
  assert.deepEqual(plan.hold.map((h) => h.id), ['note:lessons:b'])
  assert.deepEqual(plan.apply, [])
})

