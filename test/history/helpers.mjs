// Shared fixtures for the history tests. Synthetic data only.
import { formatSaves } from '../../src/lib/history/saves.js'

/** In-memory Storage. `failWhen(key, value)` returning true makes setItem throw a quota error. */
export class MemoryStorage {
  constructor(entries = {}) {
    this.map = new Map(Object.entries(entries))
    this.failWhen = null
  }
  getItem(key) {
    return this.map.has(key) ? this.map.get(key) : null
  }
  setItem(key, value) {
    if (this.failWhen?.(key, String(value))) {
      const e = new Error('The quota has been exceeded.')
      e.name = 'QuotaExceededError'
      e.code = 22
      throw e
    }
    this.map.set(key, String(value))
  }
  removeItem(key) {
    this.map.delete(key)
  }
  dump() {
    return Object.fromEntries(this.map)
  }
}

export const RUN = 'aaaaaaaa-1111-4111-8111-111111111111'
export const NEW_RUN = 'bbbbbbbb-2222-4222-8222-222222222222'
export const OTHER_RUN = 'cccccccc-3333-4333-8333-333333333333'

export const OT = 0x00020001

// Records shaped exactly as pokemon-selector.svelte writes them
export const tracker = () => ({
  'Route 1': { id: 2, pokemon: 'larvitar', status: 1, location: 'Route 1', nickname: 'Rocky', nature: 'careful' },
  'Route 2': { id: 3, pokemon: 'zubat', status: 1, location: 'Route 2' },
  'Route 3': {
    id: 5,
    pokemon: 'gastly',
    status: 5,
    location: 'Route 3',
    nickname: 'Boo',
    death: { type: 'trainer', lvl: { from: 9, to: 12 }, epitaph: 'Fell to a crit.' }
  },
  'Route 4': { id: 6, pokemon: 'eevee', status: 4, location: 'Route 4' },
  __team: ['Route 1', 'Route 2'],
  __teams: [{ id: 'r1', name: 'Rival', group: 'rival', type: 'normal', team: [{ sprite: 'larvitar', id: 'Route 1' }] }],
  __custom: [{ type: 'custom', name: 'Gift', id: 'abc123', index: 3 }],
  __hidden: ['Route 9'],
  __starter: 'fire'
})

export const snapshot = ({ party = [], boxes = {}, saveIndex = 100, badges = 3 } = {}) => ({
  schema: 2,
  game: { saveIndex },
  trainer: { name: 'TEST', id: OT & 0xffff, secretId: OT >>> 16 },
  progress: { badges, champion: false },
  party,
  boxes: Array.from({ length: 25 }, (_, i) => ({ box: i + 1, mons: (boxes[i + 1] || []).map((m, s) => ({ ...m, box: i + 1, slot: s + 1 })) }))
})

export const side = () => ({
  version: 2,
  baseline: { snapshot: snapshot(), source: 'upload', acceptedAt: 1700000000000 },
  links: { [`${OT}:11`]: 'Route 1' },
  facts: { 'Route 1': { level: 20 } }
})

export const run = (id = RUN, extra = {}) => ({ id, created: '1690000000000', updated: '1695000000000', name: 'Unbound Run', game: 'unbound', settings: '', attempts: 2, ...extra })

/** A device with one active Unbound run that has tracker, side and attempt data */
export function seeded({ runs = [run()], active = RUN } = {}) {
  const s = new MemoryStorage({
    nuzlocke: active,
    'nuzlocke.saves': formatSaves(Object.fromEntries(runs.map((r) => [r.id, r]))),
    'nuzlocke.theme': 'dark',
    'nuzlocke.unbound.syncKey': 'secret-key-should-never-be-backed-up'
  })
  for (const r of runs) s.setItem(`nuzlocke.${r.id}`, JSON.stringify(tracker()))
  s.setItem(`nuzlocke.${RUN}.unbound`, JSON.stringify(side()))
  s.setItem(`nuzlocke.${RUN}.attempt`, JSON.stringify({ version: 1, notes: 'Lost to the crit', checklist: { 'obj-1': { done: true, at: 5 } } }))
  return s
}
