// Shared state and actions for the player's notes, used by the /notes page
// and the game page's contextual notes panel. A thin layer over
// $lib/history/knowledge and $lib/history/attempt: same data, same rules.
import { writable, get } from 'svelte/store'

import { uuid } from '$lib/utils/uuid'
import { KEYS } from '$lib/history/storage'
import { parseSaves } from '$lib/history/saves'
import { readKnowledge, writeKnowledge, upsert, remove } from '$lib/history/knowledge'
import { readAttempt, writeAttempt, setChecked } from '$lib/history/attempt'
import { listArchives, isWritableRun, recordedFights } from '$lib/history/archive'

function load(storage) {
  const run = parseSaves(storage.getItem(KEYS.saves))[storage.getItem(KEYS.active)] || null
  const k = readKnowledge(storage)
  let attempt = null,
    canWriteAttempt = false,
    trackerPokemon = [],
    archives = []
  if (run) {
    const a = readAttempt(storage, run.id)
    attempt = a.attempt
    canWriteAttempt = !a.error && isWritableRun(storage, run.id)
    try {
      const t = JSON.parse(storage.getItem(KEYS.tracker(run.id)) || '{}')
      trackerPokemon = [...new Set(Object.entries(t).filter(([key, r]) => !key.startsWith('__') && r?.pokemon).map(([, r]) => r.pokemon))]
    } catch (e) {
      console.error(e)
    }
  }
  try {
    archives = listArchives(storage).map((a) => a.meta)
  } catch (e) {
    console.error(e)
  }
  return {
    run,
    game: run?.game || null,
    knowledge: k.knowledge,
    loadError: k.error ? 'Your saved notes could not be read. They are shown empty and will not be overwritten.' : null,
    attempt,
    canWriteAttempt,
    trackerPokemon,
    archives,
    error: null
  }
}

export function createNotes(storage) {
  const state = writable(load(storage))
  const fail = (e) => {
    console.error(e)
    state.update((s) => ({ ...s, error: e.message }))
    return false
  }

  const saveKnowledge = (next) => {
    const s = get(state)
    if (s.loadError) return fail(new Error('Notes can’t be saved until the stored notes are readable again.'))
    try {
      writeKnowledge(storage, next)
      state.update((x) => ({ ...x, knowledge: readKnowledge(storage).knowledge, error: null }))
      return true
    } catch (e) {
      return fail(e)
    }
  }
  const k = () => get(state).knowledge
  const now = () => Date.now()

  return {
    subscribe: state.subscribe,
    reload: () => state.set(load(storage)),
    upsertEntry: (section, entry) => saveKnowledge(upsert(k(), section, entry, now())),
    removeEntry: (section, id) => saveKnowledge(remove(k(), section, id)),
    addLesson: (fields) => saveKnowledge(upsert(k(), 'lessons', { id: uuid(), game: get(state).game, ...fields }, now())),
    deleteLesson: (id) => saveKnowledge(remove(k(), 'lessons', id)),
    addObjective: (fields) => saveKnowledge(upsert(k(), 'objectives', { id: uuid(), game: get(state).game, ...fields }, now())),
    removeObjective: (id) => saveKnowledge(remove(k(), 'objectives', id)),
    addPrep: (boss, text) => saveKnowledge(upsert(k(), 'bosses', { id: boss.id, prep: boss.prep.concat({ id: uuid(), text }) }, now())),
    removePrep: (boss, itemId) => saveKnowledge(upsert(k(), 'bosses', { id: boss.id, prep: boss.prep.filter((p) => p.id !== itemId) }, now())),
    /** Ticks a checklist/prep item for the current attempt only */
    toggle: (itemId, done) => {
      const s = get(state)
      if (!s.canWriteAttempt) return false
      try {
        const next = setChecked(s.attempt, itemId, done, now())
        writeAttempt(storage, s.run.id, next)
        state.update((x) => ({ ...x, attempt: next, error: null }))
        return true
      } catch (e) {
        return fail(e)
      }
    },
    saveAttemptNotes: (notes) => {
      const s = get(state)
      if (!s.canWriteAttempt) return false
      try {
        const next = { ...s.attempt, notes }
        writeAttempt(storage, s.run.id, next)
        state.update((x) => ({ ...x, attempt: next, error: null }))
        return true
      } catch (e) {
        return fail(e)
      }
    },
    fightsFor: (ref) => (ref ? recordedFights(storage, ref) : []),
    newEntry: (section, extra = {}) => ({ id: uuid(), game: get(state).game, ref: null, name: '', ...(section === 'bosses' ? { prep: [], attemptIds: [] } : {}), ...extra }),
    clearError: () => state.update((x) => ({ ...x, error: null }))
  }
}

/** One instance per page load, so the game page's cards and panel stay in step */
let shared = null
export const getNotes = () => (shared = shared || createNotes(localStorage))

// ---- Labels and form fields shared by the page and the panel

/** Game-page routes or bosses from the route list, as select options */
export const refOptions = (list, section) =>
  (list || [])
    .filter((p) => (section === 'routes' ? p.type === 'route' : p.type === 'gym' && p.value))
    .map((p) => (section === 'routes' ? { value: p.name, label: p.name, name: p.name } : { value: p.value, label: p.boss ? `${p.boss} · ${p.name}` : p.name, name: p.boss || p.name }))

export const entryFields = (section, routeList, archives) =>
  section === 'routes'
    ? [
        { key: 'ref', label: 'Game-page route', type: 'select', options: refOptions(routeList, 'routes') },
        { key: 'encounters', label: 'Encounter opportunities', type: 'textarea' },
        { key: 'dangers', label: 'Dangerous trainers', type: 'textarea' },
        { key: 'prep', label: 'Preparation', type: 'textarea' },
        { key: 'reminders', label: 'Items & reminders', type: 'textarea' }
      ]
    : [
        { key: 'ref', label: 'Game-page boss', type: 'select', options: refOptions(routeList, 'bosses') },
        { key: 'location', label: 'Location', type: 'text' },
        { key: 'mechanics', label: 'Battle mechanics', type: 'textarea' },
        { key: 'dangers', label: 'Dangerous moves & Pokémon', type: 'textarea' },
        { key: 'strategy', label: 'Strategy', type: 'textarea' },
        { key: 'attemptIds', label: 'Related archived attempts', type: 'attempts', options: archives.map((m) => ({ value: m.id, label: m.title || m.name })) }
      ]

/** "Current: …" for the active run, the archive's title otherwise */
export const attemptLabel = (s, id) => {
  if (s.run && id === s.run.id) return `Current: ${s.run.name} (attempt ${+s.run.attempts || 1})`
  const m = s.archives.find((a) => a.id === id)
  return m ? m.title || m.name : 'Deleted attempt'
}
