// Run with: npm run test:unbound
//
// Synthetic tests build saves in memory and always run. Fixture tests use
// real saves from test/fixtures/unbound/, which is gitignored (saves contain
// personal trainer data), and skip when no fixtures are present:
//   *.sav          real saves, named so they sort chronologically
//   expected.json  optional per-save expected values (see README.md there)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  parseUnboundSave,
  UnboundSaveError,
  ERROR_CODES,
  WARNING_CODES,
  SNAPSHOT_SCHEMA,
  SUPPORTED_SIGNATURES
} from '../../src/lib/unbound/parse.js'
import { gbaChecksum } from '../../src/lib/unbound/vendor/puse/checksum.js'
import { unboundChecksumLength } from '../../src/lib/unbound/vendor/puse/sections.js'

// ---- Synthetic save builder -------------------------------------------------

const SAVE_SIZE = 0x20000
const SECTION = 0x1000
const SLOT_B = 14 * SECTION
const UNBOUND = 0x01121999

const u16 = (buf, off, v) => new DataView(buf.buffer).setUint16(off, v, true)
const u32 = (buf, off, v) => new DataView(buf.buffer).setUint32(off, v >>> 0, true)

const sectionOffset = (base, id) => base + id * SECTION
const seal = (buf, off) => u16(buf, off + 0xff6, gbaChecksum(buf, off, unboundChecksumLength(buf[off + 0xff4])))

// Writes a structurally valid, empty 14-section slot
const writeSlot = (buf, base, { signature = UNBOUND, saveIndex = 1 } = {}) => {
  for (let id = 0; id < 14; id++) {
    const off = sectionOffset(base, id)
    buf.fill(0, off, off + SECTION)
    u16(buf, off + 0xff4, id)
    u32(buf, off + 0xff8, signature)
    u32(buf, off + 0xffc, saveIndex)
    seal(buf, off)
  }
  return buf
}

const blankSave = () => new Uint8Array(SAVE_SIZE)
const syntheticSave = (opts) => writeSlot(blankSave(), 0, opts)

// Edits a section's payload then fixes its checksum so only the edit is "wrong"
const editSection = (buf, base, id, fn) => {
  const off = sectionOffset(base, id)
  fn(off)
  seal(buf, off)
  return buf
}

const corruptSection = (buf, base, id) => {
  buf[sectionOffset(base, id) + 0x10] ^= 0xff
  return buf
}

const throwsCode = (fn, code) =>
  assert.throws(fn, (e) => {
    assert.ok(e instanceof UnboundSaveError, `expected UnboundSaveError, got ${e}`)
    assert.equal(e.code, code, e.message)
    return true
  })

// Deterministic pseudo-random bytes
const noise = (n, seed = 1) => {
  const out = new Uint8Array(n)
  for (let i = 0; i < n; i++) out[i] = (seed = (seed * 1103515245 + 12345) >>> 0) >>> 24
  return out
}

// ---- Invalid, truncated and unsupported files --------------------------------

test('rejects truncated files', () => {
  throwsCode(() => parseUnboundSave(new Uint8Array(0)), ERROR_CODES.TRUNCATED)
  throwsCode(() => parseUnboundSave(new Uint8Array(1024)), ERROR_CODES.TRUNCATED)
  // A valid slot is not enough if the PC sectors at the end are missing
  throwsCode(() => parseUnboundSave(syntheticSave().slice(0, SAVE_SIZE - SECTION)), ERROR_CODES.TRUNCATED)
})

test('reports never-saved (blank) files as empty', () => {
  throwsCode(() => parseUnboundSave(new Uint8Array(SAVE_SIZE)), ERROR_CODES.EMPTY)
  throwsCode(() => parseUnboundSave(new Uint8Array(SAVE_SIZE).fill(0xff)), ERROR_CODES.EMPTY)
})

test('rejects files that are not Unbound saves', () => {
  throwsCode(() => parseUnboundSave(noise(SAVE_SIZE)), ERROR_CODES.NOT_UNBOUND)
  throwsCode(() => parseUnboundSave(syntheticSave({ signature: 0xdeadbeef })), ERROR_CODES.NOT_UNBOUND)
})

test('every advertised signature is actually parseable by the vendored code', () => {
  for (const sig of Object.keys(SUPPORTED_SIGNATURES).map(Number)) {
    assert.equal(parseUnboundSave(syntheticSave({ signature: sig })).game.version, SUPPORTED_SIGNATURES[sig])
  }
})

test('rejects recognised but unsupported versions', () => {
  throwsCode(() => parseUnboundSave(syntheticSave({ signature: 0x01122000 })), ERROR_CODES.UNSUPPORTED_VERSION)
  throwsCode(() => parseUnboundSave(syntheticSave({ signature: 0x08012025 })), ERROR_CODES.UNSUPPORTED_VERSION)
})

test('rejects saves whose only slot fails its checksum', () => {
  throwsCode(() => parseUnboundSave(corruptSection(syntheticSave(), 0, 1)), ERROR_CODES.CORRUPT)
})

test('rejects slots with a missing section', () => {
  const buf = syntheticSave()
  editSection(buf, 0, 13, (off) => u16(buf, off + 0xff4, 12)) // duplicate id 12, no 13
  throwsCode(() => parseUnboundSave(buf), ERROR_CODES.CORRUPT)
})

// ---- Slot selection ------------------------------------------------------------

test('parses a minimal valid save as an empty game', () => {
  const s = parseUnboundSave(syntheticSave({ saveIndex: 7 }))
  assert.equal(s.schema, SNAPSHOT_SCHEMA)
  assert.equal(s.game.version, SUPPORTED_SIGNATURES[UNBOUND])
  assert.equal(s.game.saveIndex, 7)
  assert.equal(s.game.slot, 'A')
  assert.deepEqual(s.warnings, [])
  assert.deepEqual(s.party, [])
  assert.equal(s.boxes.length, 25)
  assert.ok(s.boxes.every((b) => b.mons.length === 0))
  assert.equal(s.progress.badges, 0)
  assert.deepEqual(JSON.parse(JSON.stringify(s)), s)
})

test('uses the newer of two valid slots, including across index wraparound', () => {
  const buf = writeSlot(syntheticSave({ saveIndex: 5 }), SLOT_B, { saveIndex: 6 })
  assert.deepEqual([parseUnboundSave(buf).game.slot, parseUnboundSave(buf).game.saveIndex], ['B', 6])

  const wrap = writeSlot(syntheticSave({ saveIndex: 0xffffffff }), SLOT_B, { saveIndex: 0 })
  assert.equal(parseUnboundSave(wrap).game.slot, 'B')
})

test('falls back to the previous save, with a warning, when the newest is damaged', () => {
  const buf = writeSlot(syntheticSave({ saveIndex: 5 }), SLOT_B, { saveIndex: 6 })
  corruptSection(buf, SLOT_B, 3)
  const s = parseUnboundSave(buf)
  assert.equal(s.game.slot, 'A')
  assert.equal(s.game.saveIndex, 5)
  assert.deepEqual(s.warnings.map((w) => w.code), [WARNING_CODES.NEWEST_SLOT_CORRUPT])
})

// ---- Malformed data inside a valid slot ------------------------------------------

test('rejects an impossible party count', () => {
  const buf = syntheticSave()
  editSection(buf, 0, 1, (off) => u32(buf, off + 0x34, 7))
  throwsCode(() => parseUnboundSave(buf), ERROR_CODES.INVALID_DATA)
})

test('rejects party slots that hold no real Pokémon', () => {
  const buf = syntheticSave()
  editSection(buf, 0, 1, (off) => u32(buf, off + 0x34, 1)) // count 1, mon bytes all zero
  throwsCode(() => parseUnboundSave(buf), ERROR_CODES.INVALID_DATA)
})

// ---- Real saves (skipped when fixtures are absent) -------------------------------

const FIXTURES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../fixtures/unbound')
const fixtureFiles = fs.existsSync(FIXTURES)
  ? fs.readdirSync(FIXTURES).filter((f) => f.endsWith('.sav')).sort()
  : []
const readFixture = (f) => new Uint8Array(fs.readFileSync(path.join(FIXTURES, f)))
const expectedFile = path.join(FIXTURES, 'expected.json')
const expected = fs.existsSync(expectedFile) ? JSON.parse(fs.readFileSync(expectedFile, 'utf8')) : {}

const noFixtures = fixtureFiles.length ? false : 'no fixture saves in test/fixtures/unbound'
const NATURES = 'Hardy Lonely Brave Adamant Naughty Bold Docile Relaxed Impish Lax Timid Hasty Serious Jolly Naive Modest Mild Quiet Bashful Rash Calm Gentle Sassy Careful Quirky'.split(' ')
const allMons = (s) => [...s.party, ...s.boxes.flatMap((b) => b.mons)]
const hex = (n) => n.toString(16).padStart(8, '0')

test('fixture saves parse with consistent, plausible data', { skip: noFixtures }, () => {
  for (const f of fixtureFiles) {
    const s = parseUnboundSave(readFixture(f))
    assert.deepEqual(s.warnings, [], f)
    assert.ok(s.party.length <= 6, f)
    assert.equal(s.boxes.length, 25, f)
    const otId = ((s.trainer.secretId << 16) | s.trainer.id) >>> 0
    for (const m of allMons(s)) assert.equal(m.otId, otId, `${f}: ${m.nickname} not owned by trainer`)
    assert.deepEqual(JSON.parse(JSON.stringify(s)), s, f)
    for (const m of s.party) assert.ok([null, 'sleep', 'poison', 'burn', 'freeze', 'paralysis', 'toxic'].includes(m.status), `${f}: status ${m.status}`)
    for (const m of allMons(s)) assert.ok(m.species.label && m.species.name, `${f}: unnamed species ${m.species.id}`)
    for (const m of allMons(s)) assert.ok(NATURES.includes(m.nature), `${f}: ${m.nickname} nature ${m.nature}`)
  }
})

test('fixture saves match their recorded expected values', { skip: noFixtures || (!Object.keys(expected).length && 'no expected.json') }, () => {
  for (const f of fixtureFiles) {
    const want = expected.saves?.[f]
    if (!want) continue
    const s = parseUnboundSave(readFixture(f))
    const got = {
      saveIndex: s.game.saveIndex,
      trainer: s.trainer,
      playtime: s.playtime,
      badges: s.progress.badges,
      levelCap: s.progress.levelCap.normal,
      party: s.party.map((m) => m.nickname),
      boxes: Object.fromEntries(s.boxes.filter((b) => b.mons.length).map((b) => [b.box, b.mons.map((m) => m.nickname)])),
      mons: Object.fromEntries(
        allMons(s).map((m) => [hex(m.pid), { species: m.species.label, level: m.level, met: m.met }])
      )
    }
    assert.deepEqual(got, want, f)
  }
})

test('fixture saves in order show monotonic progress and stable PIDs', { skip: fixtureFiles.length < 2 && 'needs two fixture saves' }, () => {
  const snaps = fixtureFiles.map((f) => parseUnboundSave(readFixture(f)))
  for (let i = 1; i < snaps.length; i++) {
    const [a, b] = [snaps[i - 1], snaps[i]]
    assert.ok(b.game.saveIndex > a.game.saveIndex, 'save index increases')
    assert.ok(b.progress.badges >= a.progress.badges, 'badges never decrease')
    const later = new Map(allMons(b).map((m) => [m.pid, m]))
    for (const m of allMons(a)) {
      const next = later.get(m.pid)
      if (!next) continue // released; not an error
      assert.deepEqual(next.met, m.met, `${hex(m.pid)} met data changed`)
      assert.equal(next.nature, m.nature, `${hex(m.pid)} nature differs between party/PC readings`)
      assert.ok(next.level >= m.level, `${hex(m.pid)} lost levels`)
    }
  }
})

test('damage to a real save is detected, never parsed as data', { skip: noFixtures }, () => {
  const original = readFixture(fixtureFiles.at(-1))
  const { game } = parseUnboundSave(original)
  const newest = game.slot === 'A' ? 0 : SLOT_B
  const findSection = (base, id) => {
    for (let i = 0; i < 14; i++) if (original[base + i * SECTION + 0xff4] === id) return base + i * SECTION
  }

  throwsCode(() => parseUnboundSave(original.slice(0, SAVE_SIZE - SECTION)), ERROR_CODES.TRUNCATED)

  // Damage the party section of the newest slot: the previous save is used, with a warning
  const oneBad = original.slice()
  oneBad[findSection(newest, 1) + 0x40] ^= 0xff
  const fallback = parseUnboundSave(oneBad)
  assert.notEqual(fallback.game.slot, game.slot)
  assert.ok(fallback.game.saveIndex < game.saveIndex)
  assert.deepEqual(fallback.warnings.map((w) => w.code), [WARNING_CODES.NEWEST_SLOT_CORRUPT])

  // Damage both slots: nothing is returned
  const bothBad = oneBad.slice()
  bothBad[findSection(newest === 0 ? SLOT_B : 0, 1) + 0x40] ^= 0xff
  throwsCode(() => parseUnboundSave(bothBad), ERROR_CODES.CORRUPT)
})
