// Parses a Pokémon Unbound .sav into a plain, JSON-serialisable snapshot of
// objective game state. Uses only relative imports so it runs in both the
// browser (Vite) and Node (tests).
//
// Save-format logic comes from PUSE (vendor/puse, MIT). Raw field offsets for
// trainer data, met location and event flags follow Unbound-Cloud's
// documented layout (github.com/Skeli789/Unbound-Cloud).
//
// Never returns partial data: anything that isn't a complete, checksum-valid
// Unbound 2.1 save throws an UnboundSaveError with a machine-readable `code`.
import { activeUnboundSlot, findActiveSectionById } from './vendor/puse/sections.js'
import { decodeText, getParty } from './vendor/puse/party.js'
import { getMonBufferAndOffset, getPcBox, loadPcContext } from './vendor/puse/pc.js'
import { countBadges, isChampion, readEventFlag } from './vendor/puse/gameProgress.js'
import {
  computeExpertLevelCapFromProgress,
  computeNormalLevelCapFromProgress
} from './vendor/puse/levelCap.js'
import { readMoney } from './vendor/puse/money.js'
import { ru8, ru16, ru32 } from './vendor/puse/binary.js'
import names from './vendor/puse/names.data.js'

export const SNAPSHOT_SCHEMA = 1

// Signatures PUSE can parse (must match UNBOUND_SIGNATURES in vendor sections.js)
export const SUPPORTED_SIGNATURES = {
  0x01121999: 'Unbound 2.1.0 - 2.1.1.1',
  0x01121998: 'Unbound 2.1 (0x01121998)'
}

// Recognised, but not parseable by this version of the parser
const UNSUPPORTED_SIGNATURES = {
  0x01122000: 'Unbound before 2.1',
  0x08012025: 'unmodified FireRed / LeafGreen'
}

export const ERROR_CODES = {
  TRUNCATED: 'truncated',
  EMPTY: 'empty',
  UNSUPPORTED_VERSION: 'unsupported-version',
  NOT_UNBOUND: 'not-unbound',
  CORRUPT: 'corrupt',
  INVALID_DATA: 'invalid-data',
  PARSE_FAILED: 'parse-failed'
}

export const WARNING_CODES = {
  NEWEST_SLOT_CORRUPT: 'newest-slot-corrupt'
}

const SAVE_SIZE = 0x20000 // boxes 20-24 live in the final sectors
const SECTION_SIZE = 0x1000
const SLOT_SECTIONS = 14
const SLOT_B = SLOT_SECTIONS * SECTION_SIZE
const FOOTER_SIGNATURE = 0xff8
const FOOTER_SAVE_INDEX = 0xffc
const BOX_COUNT = 25
const PC_MON_SIZE = 58

// SaveBlock2 (section 0)
const SB2_NAME = 0x00
const SB2_TRAINER_ID = 0x0a
const SB2_PLAYTIME = 0x0e

// SaveBlock1 (section 1)
const SB1_PARTY_COUNT = 0x34
const SB1_PARTY = 0x38
const PARTY_MON_SIZE = 100
const PARTY_MAX = 6

// Party mons are stored unencrypted in CFRU; misc substruct starts at 0x44
const PARTY_OT_ID = 0x04
const PARTY_HP = 0x56
const PARTY_MAX_HP = 0x58
const PARTY_MET_LOCATION = 0x45
const PARTY_MET_INFO = 0x46

// Compressed 58-byte PC mons
const PC_OT_ID = 0x04
const PC_MET_LOCATION = 51
const PC_MET_INFO = 52

// Event flags
const FLAG_SPECIES_RANDOMIZER = 0x9fd
const FLAG_LEARNSET_RANDOMIZER = 0x9fe
const FLAG_NEW_GAME_PLUS = 0x16db
const FLAG_SANDBOX_MODE = 0x16e4

const toMap = (obj) => new Map(Object.entries(obj).map(([id, name]) => [+id, name]))
const SPECIES = toMap(names.species)
const ITEMS = toMap(names.items)
const MOVES = toMap(names.moves)

export class UnboundSaveError extends Error {
  constructor(code, message, options) {
    super(message, options)
    this.name = 'UnboundSaveError'
    this.code = code
  }
}

const hex = (n) => '0x' + (n >>> 0).toString(16).padStart(8, '0')

// True if save index `a` is newer than `b` (indices wrap at 2^32)
const isNewer = (a, b) => {
  const delta = (a - b) >>> 0
  return delta > 0 && delta < 0x80000000
}

const slotFooter = (buf, base) => ({
  signature: ru32(buf, base + FOOTER_SIGNATURE) >>> 0,
  saveIndex: ru32(buf, base + FOOTER_SAVE_INDEX) >>> 0
})

const isBlank = (buf, end) => {
  const first = buf[0]
  if (first !== 0x00 && first !== 0xff) return false
  for (let i = 1; i < end; i++) if (buf[i] !== first) return false
  return true
}

// Picks the save slot the game would load, or explains why there isn't one
const selectSlot = (buf) => {
  if (buf.length < SAVE_SIZE)
    throw new UnboundSaveError(
      ERROR_CODES.TRUNCATED,
      `Save is ${buf.length} bytes; a complete Unbound save is ${SAVE_SIZE} bytes`
    )

  const slot = activeUnboundSlot(buf)
  if (slot.size === SLOT_SECTIONS) {
    const chosen = slot.get(0)
    const name = chosen.offset < SLOT_B ? 'A' : 'B'
    const other = slotFooter(buf, name === 'A' ? SLOT_B : 0)
    const warnings =
      other.signature in SUPPORTED_SIGNATURES && isNewer(other.saveIndex, chosen.idx)
        ? [
            {
              code: WARNING_CODES.NEWEST_SLOT_CORRUPT,
              message: `Newest save (index ${other.saveIndex}) is damaged; showing the previous save (index ${chosen.idx})`
            }
          ]
        : []
    return { name, saveIndex: chosen.idx, warnings }
  }

  if (isBlank(buf, 2 * SLOT_B))
    throw new UnboundSaveError(ERROR_CODES.EMPTY, 'Save file is empty; the game has not been saved yet')

  const signatures = [slotFooter(buf, 0).signature, slotFooter(buf, SLOT_B).signature]
  if (signatures.some((s) => s in SUPPORTED_SIGNATURES))
    throw new UnboundSaveError(
      ERROR_CODES.CORRUPT,
      'Neither save slot passed integrity checks (missing sections or bad checksums)'
    )

  const known = signatures.find((s) => s in UNSUPPORTED_SIGNATURES)
  if (known !== undefined)
    throw new UnboundSaveError(
      ERROR_CODES.UNSUPPORTED_VERSION,
      `Save is from ${UNSUPPORTED_SIGNATURES[known]} (${hex(known)}); only Unbound 2.1 is supported`
    )

  throw new UnboundSaveError(
    ERROR_CODES.NOT_UNBOUND,
    `Not an Unbound save (signature ${hex(signatures[0])})`
  )
}

const invalid = (where, message) =>
  new UnboundSaveError(ERROR_CODES.INVALID_DATA, `${where}: ${message}`)

const checkMon = (mon, where) => {
  if (!mon.species.id || !SPECIES.has(mon.species.id))
    throw invalid(where, `unknown species id ${mon.species.id}`)
  if (!Number.isInteger(mon.level) || mon.level < 1 || mon.level > 100)
    throw invalid(where, `level ${mon.level} out of range`)
  if (mon.hp && (mon.hp.max === 0 || mon.hp.current > mon.hp.max))
    throw invalid(where, `HP ${mon.hp.current}/${mon.hp.max} is impossible`)
  return mon
}

const readTrainer = (buf) => {
  const { off } = findActiveSectionById(buf, 0)
  const id = ru32(buf, off + SB2_TRAINER_ID) >>> 0
  return {
    name: decodeText(buf.slice(off + SB2_NAME, off + SB2_NAME + 8)),
    id: id & 0xffff,
    secretId: id >>> 16
  }
}

const readPlaytime = (buf) => {
  const { off } = findActiveSectionById(buf, 0)
  return {
    hours: ru16(buf, off + SB2_PLAYTIME),
    minutes: ru8(buf, off + SB2_PLAYTIME + 2),
    seconds: ru8(buf, off + SB2_PLAYTIME + 3)
  }
}

const met = (raw, locationOffset, infoOffset) => ({
  locationId: ru8(raw, locationOffset),
  level: ru16(raw, infoOffset) & 0x7f
})

// Common shape for party and PC mons; `p` is PUSE's parsed mon
const toMon = (p, raw, { otIdOffset, metLocation, metInfo }) => ({
  pid: p.pid >>> 0,
  otId: ru32(raw, otIdOffset) >>> 0,
  species: { id: p.species_id, name: p.species_name || SPECIES.get(p.species_id) || null },
  nickname: p.nickname,
  level: p.level,
  nature: p.nature || null,
  ability: p.effective_ability_name || null,
  item: p.item_id ? ITEMS.get(p.item_id) || `Item #${p.item_id}` : null,
  moves: (p.moves || [])
    .map((m) => (typeof m === 'object' ? m?.id : m))
    .filter((id) => id > 0)
    .map((id) => MOVES.get(id) || `Move #${id}`),
  shiny: Boolean(p.is_shiny),
  gender: p.gender || null,
  ball: p.ball_name || null,
  met: met(raw, metLocation, metInfo)
})

const readParty = (buf) => {
  const { off } = findActiveSectionById(buf, 1)
  const count = ru32(buf, off + SB1_PARTY_COUNT)
  if (count > PARTY_MAX) throw invalid('Party', `count ${count} exceeds ${PARTY_MAX}`)

  const party = getParty(buf, SPECIES)
  if (party.length !== count) throw invalid('Party', `expected ${count} mons, read ${party.length}`)

  return party.map((p, i) => {
    const start = off + SB1_PARTY + i * PARTY_MON_SIZE
    const raw = buf.subarray(start, start + PARTY_MON_SIZE)
    const mon = {
      ...toMon(p, raw, {
        otIdOffset: PARTY_OT_ID,
        metLocation: PARTY_MET_LOCATION,
        metInfo: PARTY_MET_INFO
      }),
      hp: { current: ru16(raw, PARTY_HP), max: ru16(raw, PARTY_MAX_HP) }
    }
    return checkMon(mon, `Party slot ${i + 1}`)
  })
}

const readBoxes = (buf) => {
  const ctx = loadPcContext(buf)
  const boxes = []
  for (let box = 1; box <= BOX_COUNT; box++) {
    const mons = getPcBox(ctx, box, SPECIES).map((p) => {
      const where = `Box ${box} slot ${p.slot}`
      const { buffer, offset } = getMonBufferAndOffset(ctx, box, p.slot)
      const raw = buffer.subarray(offset, offset + PC_MON_SIZE)
      if (ru32(raw, 0) >>> 0 !== p.pid >>> 0)
        throw invalid(where, 'raw record does not match parsed mon')
      const mon = {
        ...toMon(p, raw, {
          otIdOffset: PC_OT_ID,
          metLocation: PC_MET_LOCATION,
          metInfo: PC_MET_INFO
        }),
        box,
        slot: p.slot
      }
      return checkMon(mon, where)
    })
    boxes.push({ box, mons })
  }
  return boxes
}

/**
 * @param {ArrayBuffer | Uint8Array} bytes raw .sav contents (128KB)
 * @returns snapshot of objective game state
 * @throws {UnboundSaveError} if the file is not a complete, valid Unbound 2.1 save
 */
export function parseUnboundSave(bytes) {
  const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  const slot = selectSlot(buf)
  const { off } = findActiveSectionById(buf, 0)
  const signature = ru32(buf, off + FOOTER_SIGNATURE) >>> 0

  try {
    const badges = countBadges(buf)
    const champion = isChampion(buf)
    const progress = { badgeCount: badges, isChampion: champion }

    return {
      schema: SNAPSHOT_SCHEMA,
      game: {
        signature: hex(signature),
        version: SUPPORTED_SIGNATURES[signature],
        saveIndex: slot.saveIndex,
        slot: slot.name
      },
      warnings: slot.warnings,
      trainer: readTrainer(buf),
      playtime: readPlaytime(buf),
      progress: {
        badges,
        champion,
        levelCap: {
          normal: computeNormalLevelCapFromProgress(progress),
          expert: computeExpertLevelCapFromProgress(progress)
        },
        money: readMoney(buf)
      },
      modes: {
        speciesRandomizer: readEventFlag(buf, FLAG_SPECIES_RANDOMIZER),
        learnsetRandomizer: readEventFlag(buf, FLAG_LEARNSET_RANDOMIZER),
        newGamePlus: readEventFlag(buf, FLAG_NEW_GAME_PLUS),
        sandbox: readEventFlag(buf, FLAG_SANDBOX_MODE)
      },
      party: readParty(buf),
      boxes: readBoxes(buf)
    }
  } catch (e) {
    if (e instanceof UnboundSaveError) throw e
    throw new UnboundSaveError(ERROR_CODES.PARSE_FAILED, `Could not read save: ${e.message}`, {
      cause: e
    })
  }
}
