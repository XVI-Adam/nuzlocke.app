// Reconciles tracker records with an accepted save snapshot. Pure module.
//
// Identity: a save mon is `otId:pid`. Links (identity -> tracker record key)
// live in the side key (side.js), never on tracker records.
//
// What it may change on a linked, living record (status != Dead):
//   pokemon (species/evolution, only to a verified tracker alias),
//   nickname (only when the save mon has a real nickname), nature
// plus __team, mirrored from the save's party when every party member is
// linked. Everything else - record keys, id, location, status, death,
// hidden, __teams, __custom, unlinked records - is never touched. Records
// are never created or deleted, and nothing is ever marked dead.
//
// First-time links are made automatically only for a unique eligible
// candidate in the same evolution line with an exact normalized nickname
// match; everything else needs the player's choice.
import { describeSpecies, aliasFor } from './species.js'
import { identityOf, trackerRecords, validateLinks } from './side.js'
import { DEFAULT_GRAVEYARD_BOX } from './diff.js'

const DEAD = 5
// Captured, Received, Traded, Shiny, Dead: statuses that represent a real mon
const LINKABLE = new Set([1, 2, 3, 6, DEAD])

const NATURES = new Set(
  'hardy lonely brave adamant naughty bold docile relaxed impish lax timid hasty serious jolly naive modest mild quiet bashful rash calm gentle sassy careful quirky'.split(
    ' '
  )
)

const norm = (s) =>
  String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase()

const nameKey = (s) => norm(s).replace(/[^a-z0-9]/g, '')

/**
 * @param snapshot  parsed save (parse.js) being accepted
 * @param tracker   the run's tracker blob (object)
 * @param side      normalized side key (side.js)
 * @param lookup    alias -> tracker Pokémon data ({ alias, name, evoline }) or undefined
 * @param choices   { [identity]: recordKey | null } the player's review decisions
 */
export function planReconciliation({ snapshot, tracker, side, lookup, choices = {}, graveyardBox = DEFAULT_GRAVEYARD_BOX }) {
  const records = trackerRecords(tracker)
  const graveyard = `box ${graveyardBox}`

  // ---- Save mons and their identities
  const mons = [
    ...snapshot.party.map((m, i) => ({ ...m, where: 'party', partyIndex: i })),
    ...snapshot.boxes.flatMap((b) => b.mons.map((m) => ({ ...m, where: `box ${b.box}` })))
  ]
  const unmatchable = []
  const byIdentity = new Map()
  const seen = {}
  for (const m of mons) {
    const identity = identityOf(m)
    if (!identity) unmatchable.push({ mon: brief(m), reason: 'missing-identity' })
    else (seen[identity] = seen[identity] || []).push(m)
  }
  for (const [identity, list] of Object.entries(seen)) {
    if (list.length > 1) list.forEach((m) => unmatchable.push({ mon: brief(m), reason: 'duplicate-identity' }))
    else byIdentity.set(identity, list[0])
  }

  // ---- Species helpers
  const trackerSpecies = (key) => lookup(records[key].pokemon)
  // true / false, or null when it can't be verified (the save species has a
  // tracker alias, but this game's runtime Pokémon data doesn't include it)
  const sameLine = (key, mon) => {
    const rec = trackerSpecies(key)
    if (!rec) return false
    const saveAlias = aliasFor(mon.species.id)
    const save = saveAlias && lookup(saveAlias)
    if (save) return !!rec.evoline && rec.evoline === save.evoline
    if (nameKey(rec.name) === nameKey(describeSpecies(mon.species.id).name)) return true
    return saveAlias ? null : false
  }
  const isDefaultNickname = (mon) => norm(mon.nickname) === norm(describeSpecies(mon.species.id).name)
  const nicknameMatches = (key, mon) => {
    const recordNick = records[key].nickname
    return recordNick ? norm(recordNick) === norm(mon.nickname) : isDefaultNickname(mon)
  }

  // ---- Existing links: keep only those still pointing at the same mon
  const { links: wellFormed, rejected } = validateLinks(side.links, tracker)
  const staleLinks = rejected.map((r) => ({ ...r }))
  const links = {}
  for (const [identity, key] of Object.entries(wellFormed)) {
    const mon = byIdentity.get(identity)
    // Unverifiable (null) keeps the link; its species just won't be updated
    if (mon && sameLine(key, mon) === false) staleLinks.push({ identity, key, reason: 'species-mismatch' })
    else links[identity] = key
  }
  const linkedKeys = () => new Set(Object.values(links))

  // ---- First-time matching for unlinked mons
  const candidatesFor = (mon) =>
    Object.keys(records).filter((key) => !linkedKeys().has(key) && LINKABLE.has(records[key].status) && sameLine(key, mon) === true)

  const autoLinks = []
  const review = []
  const unmatched = []
  const skipped = []

  // Player decisions first: each must pick an offered candidate, or skip (null)
  for (const [identity, mon] of byIdentity) {
    if (links[identity] || !(identity in choices)) continue
    const choice = choices[identity]
    if (choice === null) skipped.push({ identity, mon: brief(mon) })
    else if (candidatesFor(mon).includes(choice)) {
      links[identity] = choice
      autoLinks.push({ identity, key: choice, mon: brief(mon), by: 'player' })
    }
  }

  const pending = [...byIdentity].filter(([identity]) => !links[identity] && choices[identity] !== null)
  const proposals = new Map() // identity -> { candidates, matching }
  for (const [identity, mon] of pending) {
    const candidates = candidatesFor(mon)
    proposals.set(identity, { candidates, matching: candidates.filter((k) => nicknameMatches(k, mon)) })
  }
  // A record wanted by more than one save mon is never auto-linked
  const wanted = {}
  for (const [, p] of proposals) if (p.matching.length === 1) wanted[p.matching[0]] = (wanted[p.matching[0]] || 0) + 1

  for (const [identity, mon] of pending) {
    const { candidates, matching } = proposals.get(identity)
    if (!candidates.length) unmatched.push({ identity, mon: brief(mon) })
    else if (matching.length === 1 && wanted[matching[0]] === 1 && !linkedKeys().has(matching[0])) {
      links[identity] = matching[0]
      autoLinks.push({ identity, key: matching[0], mon: brief(mon), by: 'nickname' })
    } else
      review.push({
        identity,
        mon: brief(mon),
        reason: matching.length > 1 || (matching.length === 1 && wanted[matching[0]] > 1) ? 'ambiguous' : 'nickname-mismatch',
        candidates: candidates.map((key) => ({ key, nickname: records[key].nickname || null, pokemon: records[key].pokemon, nicknameMatch: matching.includes(key) }))
      })
  }

  // ---- Field updates, facts and suggestions for linked mons in the save
  const updates = []
  const facts = {}
  const unmappedSpecies = []
  const possibleDeaths = []
  const conflicts = []
  for (const [identity, key] of Object.entries(links)) {
    const mon = byIdentity.get(identity)
    if (!mon) continue
    const record = records[key]
    facts[key] = factsOf(mon, identity, snapshot.game.saveIndex)

    if (record.status === DEAD) {
      // Death records are preserved as-is; only flag contradictions
      if (mon.where === 'party') conflicts.push({ key, identity, mon: brief(mon), reason: 'dead-in-party' })
      continue
    }
    if (!LINKABLE.has(record.status)) {
      // Status changed to e.g. Missed/Trash after linking: leave the record alone
      conflicts.push({ key, identity, mon: brief(mon), reason: 'record-not-active' })
      continue
    }
    if (mon.where === graveyard) possibleDeaths.push({ key, identity, mon: brief(mon) })

    const changes = {}
    const alias = aliasFor(mon.species.id)
    if (alias && lookup(alias)) {
      if (alias !== record.pokemon) changes.pokemon = alias
    } else if (nameKey(trackerSpecies(key)?.name) !== nameKey(describeSpecies(mon.species.id).name)) {
      unmappedSpecies.push({ key, identity, species: describeSpecies(mon.species.id).label })
    }
    // Real renames only: case/accent-only differences keep the tracker's spelling
    if (!isDefaultNickname(mon) && norm(mon.nickname) !== norm(record.nickname)) changes.nickname = mon.nickname
    const nature = norm(mon.nature)
    if (NATURES.has(nature) && nature !== record.nature) changes.nature = nature

    if (Object.keys(changes).length)
      updates.push({
        key,
        identity,
        mon: brief(mon),
        changes: Object.fromEntries(Object.entries(changes).map(([f, to]) => [f, { from: record[f] ?? null, to }]))
      })
  }

  // ---- __team mirrors the save party, but only when every member is linked
  const party = mons.filter((m) => m.where === 'party')
  const keyOf = Object.fromEntries(Object.entries(links).map(([identity, key]) => [identity, key]))
  const unresolved = party.filter((m) => !keyOf[identityOf(m)])
  const currentTeam = Array.isArray(tracker.__team) ? tracker.__team : []
  let team
  if (unresolved.length) team = { status: 'unresolved', unresolved: unresolved.map(brief), from: currentTeam, to: currentTeam }
  else {
    const to = party.map((m) => keyOf[identityOf(m)]).filter((key) => records[key].status !== DEAD).slice(0, 6)
    const changed = to.length !== currentTeam.length || to.some((k, i) => currentTeam[i] !== k)
    team = { status: changed ? 'changed' : 'unchanged', from: currentTeam, to }
  }

  const notFound = Object.entries(links)
    .filter(([identity]) => !byIdentity.has(identity))
    .map(([identity, key]) => ({ identity, key }))

  return { links, facts, updates, autoLinks, review, skipped, unmatched, unmatchable, staleLinks, notFound, possibleDeaths, conflicts, unmappedSpecies, team }
}

/**
 * Applies a plan. Only fields that differ are written, so applying the same
 * save twice changes nothing the second time.
 * @returns {{ tracker, side, changed: boolean }}
 */
export function applyReconciliation({ tracker, side, plan, snapshot, source, acceptedAt }) {
  let changed = false
  const next = { ...tracker }
  for (const u of plan.updates) {
    const record = { ...tracker[u.key] }
    for (const [field, { to }] of Object.entries(u.changes)) record[field] = to
    next[u.key] = record
    changed = true
  }
  if (plan.team.status === 'changed') {
    next.__team = plan.team.to
    changed = true
  }

  // Keep facts for linked mons that weren't in this save; drop facts for unlinked records
  const linkedKeys = new Set(Object.values(plan.links))
  const keptFacts = Object.fromEntries(Object.entries(side.facts || {}).filter(([key]) => linkedKeys.has(key)))

  return {
    tracker: changed ? next : tracker,
    side: {
      ...side,
      links: plan.links,
      facts: { ...keptFacts, ...plan.facts },
      baseline: { snapshot, source, acceptedAt }
    },
    changed
  }
}

function brief(m) {
  return {
    pid: m.pid,
    nickname: m.nickname,
    speciesId: m.species.id,
    species: describeSpecies(m.species.id).label,
    level: m.level,
    where: m.where,
    // display only (lib/unbound/locations.js); never used for matching
    metLocationId: m.met?.locationId ?? null
  }
}

function factsOf(m, identity, saveIndex) {
  return {
    identity,
    speciesId: m.species.id,
    species: describeSpecies(m.species.id).label,
    nickname: m.nickname,
    level: m.level,
    nature: m.nature,
    ability: m.ability,
    item: m.item,
    moves: m.moves,
    ...(m.hp ? { hp: m.hp, status: m.status ?? null } : {}),
    where: m.where,
    saveIndex
  }
}
