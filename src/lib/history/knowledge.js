// Reusable knowledge that outlives attempts (`nuzlocke.knowledge`). Never
// touched by starting a new attempt. Only the player's own notes - nothing
// here is pre-populated.
//
//   { version: 1, routes: [], bosses: [], objectives: [], lessons: [] }
//
// Every entry has a uuid `id`, `createdAt`/`updatedAt` and an optional
// `game` tag (null = any game). Routes and bosses may point at the game's
// route list (`ref`: route name or boss id from routes.json); custom ones
// (side-quest minibosses, optional encounters) have `ref: null`.
import { KEYS, readJSON, stringify, transact, isPlainObject, isValidId } from './storage.js'

export const KNOWLEDGE_VERSION = 1
export const SECTIONS = ['routes', 'bosses', 'objectives', 'lessons']
export const PRIORITIES = ['high', 'normal', 'low']

const str = (v, max = 8000) => (typeof v === 'string' ? v.slice(0, max) : '')
const optStr = (v, max = 200) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null)
const optId = (v) => (isValidId(v) ? v : null)
const time = (v) => (Number.isFinite(v) ? v : null)

const base = (e) => ({ id: e.id, game: optStr(e.game, 64), createdAt: time(e.createdAt), updatedAt: time(e.updatedAt) })

const NORMALIZERS = {
  routes: (e) => ({
    ...base(e),
    ref: optStr(e.ref),
    name: str(e.name, 200),
    encounters: str(e.encounters),
    dangers: str(e.dangers),
    prep: str(e.prep),
    reminders: str(e.reminders)
  }),
  bosses: (e) => ({
    ...base(e),
    ref: optStr(e.ref),
    name: str(e.name, 200),
    location: str(e.location, 200),
    mechanics: str(e.mechanics),
    dangers: str(e.dangers),
    strategy: str(e.strategy),
    prep: (Array.isArray(e.prep) ? e.prep : [])
      .filter((p) => isPlainObject(p) && isValidId(p.id) && typeof p.text === 'string')
      .map((p) => ({ id: p.id, text: p.text.slice(0, 500) })),
    attemptIds: (Array.isArray(e.attemptIds) ? e.attemptIds : []).filter(isValidId)
  }),
  objectives: (e) => ({
    ...base(e),
    name: str(e.name, 200),
    routeId: optId(e.routeId),
    bossId: optId(e.bossId),
    notes: str(e.notes),
    priority: PRIORITIES.includes(e.priority) ? e.priority : 'normal'
  }),
  lessons: (e) => ({
    ...base(e),
    text: str(e.text),
    routeId: optId(e.routeId),
    bossId: optId(e.bossId),
    pokemon: optStr(e.pokemon, 64),
    attemptId: optId(e.attemptId)
  })
}

export const normalizeEntry = (section, e) => NORMALIZERS[section](e)

export function normalizeKnowledge(raw) {
  const k = isPlainObject(raw) ? raw : {}
  const out = { version: KNOWLEDGE_VERSION }
  for (const section of SECTIONS) {
    const seen = new Set()
    out[section] = (Array.isArray(k[section]) ? k[section] : [])
      .filter((e) => isPlainObject(e) && isValidId(e.id) && !seen.has(e.id) && seen.add(e.id))
      .map((e) => normalizeEntry(section, e))
  }
  return out
}

/** @returns {{ knowledge, error }} error set when stored data exists but is unreadable */
export function readKnowledge(storage) {
  const r = readJSON(storage, KEYS.knowledge)
  return { knowledge: normalizeKnowledge(r.value), error: r.error }
}

/** Refuses to overwrite stored knowledge that couldn't be read */
export function writeKnowledge(storage, knowledge) {
  if (readJSON(storage, KEYS.knowledge).error) throw new Error('Stored notes could not be read, so they were not overwritten.')
  transact(storage, [{ key: KEYS.knowledge, raw: stringify(normalizeKnowledge(knowledge), 'notes') }])
}

/** Adds or replaces an entry (by id) */
export function upsert(knowledge, section, entry, now) {
  const existing = knowledge[section].find((e) => e.id === entry.id)
  const next = normalizeEntry(section, { ...existing, ...entry, createdAt: existing?.createdAt ?? now, updatedAt: now })
  return {
    ...knowledge,
    [section]: existing ? knowledge[section].map((e) => (e.id === entry.id ? next : e)) : knowledge[section].concat(next)
  }
}

/** Removes an entry; lessons/objectives pointing at a removed route or boss are kept, unlinked */
export function remove(knowledge, section, id) {
  const unlink = (field) => (e) => (e[field] === id ? { ...e, [field]: null } : e)
  const k = { ...knowledge, [section]: knowledge[section].filter((e) => e.id !== id) }
  if (section === 'routes' || section === 'bosses') {
    const field = section === 'routes' ? 'routeId' : 'bossId'
    k.lessons = k.lessons.map(unlink(field))
    k.objectives = k.objectives.map(unlink(field))
  }
  return k
}

/** Entries for a game: tagged with it, or untagged. No game = everything. */
export const forGame = (entries, game) => (game ? entries.filter((e) => !e.game || e.game === game) : entries)

export const findByRef = (knowledge, section, game, ref) =>
  forGame(knowledge[section], game).find((e) => e.ref && e.ref === ref) || null

/** Lessons and objectives linked to a route or boss entry */
export function linkedTo(knowledge, section, id) {
  const field = section === 'routes' ? 'routeId' : 'bossId'
  return {
    lessons: knowledge.lessons.filter((l) => l[field] === id),
    objectives: knowledge.objectives.filter((o) => o[field] === id)
  }
}

/** How much is written for a route/boss, for the game-page badge */
export function noteCount(knowledge, section, entry) {
  if (!entry) return 0
  const fields = section === 'routes' ? ['encounters', 'dangers', 'prep', 'reminders'] : ['mechanics', 'dangers', 'strategy']
  const { lessons, objectives } = linkedTo(knowledge, section, entry.id)
  return fields.filter((f) => entry[f]?.trim()).length + (section === 'bosses' ? entry.prep.length : 0) + lessons.length + objectives.length
}
