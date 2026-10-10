// The per-run Unbound side key (`nuzlocke.<run>.unbound`), stored apart from
// the tracker blob so tracker components can never strip it:
//
//   { version: 2,
//     baseline: { snapshot, source, acceptedAt } | null,  // last accepted save
//     links: { "<otId>:<pid>": "<tracker record key>" },  // save mon -> record
//     facts: { "<record key>": { ...objective game facts } } }
//
// Version 1 was `{ baseline }` only and is read transparently. Pure module.

export const SIDE_VERSION = 2

const IDENTITY_RE = /^\d+:\d+$/

/** Stable identity of a save mon, or null when either half is missing/zero */
const isU32 = (n) => Number.isInteger(n) && n > 0 && n <= 0xffffffff
export const identityOf = (mon) => (isU32(mon?.pid) && isU32(mon?.otId) ? `${mon.otId}:${mon.pid}` : null)

const isPlainObject = (o) => !!o && typeof o === 'object' && !Array.isArray(o)

const isBaseline = (b) =>
  isPlainObject(b) &&
  isPlainObject(b.snapshot) &&
  Number.isInteger(b.snapshot.schema) &&
  Number.isInteger(b.snapshot.game?.saveIndex) &&
  isPlainObject(b.snapshot.trainer) &&
  Array.isArray(b.snapshot.party) &&
  Array.isArray(b.snapshot.boxes) &&
  Number.isFinite(b.acceptedAt)

/** Reads any stored version into the current shape, dropping malformed parts */
export function normalizeSide(raw) {
  const side = isPlainObject(raw) ? raw : {}
  return {
    version: SIDE_VERSION,
    baseline: isBaseline(side.baseline) ? side.baseline : null,
    links: isPlainObject(side.links) ? side.links : {},
    facts: isPlainObject(side.facts) ? side.facts : {}
  }
}

/** Tracker records that hold a Pokémon, keyed by record key */
export const trackerRecords = (tracker) =>
  Object.fromEntries(
    Object.entries(tracker || {}).filter(([key, r]) => !key.startsWith('__') && isPlainObject(r) && r.pokemon)
  )

/**
 * Keeps only links whose identity is well-formed and whose record exists and
 * holds a Pokémon. A record claimed by more than one identity is ambiguous,
 * so all of those links are rejected.
 * @returns {{ links, rejected: [{ identity, key, reason }] }}
 */
export function validateLinks(links, tracker) {
  const records = trackerRecords(tracker)
  const rejected = []
  const claims = {}
  for (const [identity, key] of Object.entries(isPlainObject(links) ? links : {})) {
    if (!IDENTITY_RE.test(identity) || identity.split(':').some((n) => !(Number(n) > 0)))
      rejected.push({ identity, key, reason: 'invalid-identity' })
    else if (typeof key !== 'string' || !records[key]) rejected.push({ identity, key, reason: 'record-missing' })
    else (claims[key] = claims[key] || []).push(identity)
  }
  const valid = {}
  for (const [key, identities] of Object.entries(claims)) {
    if (identities.length === 1) valid[identities[0]] = key
    else identities.forEach((identity) => rejected.push({ identity, key, reason: 'record-claimed-twice' }))
  }
  return { links: valid, rejected }
}

/**
 * .nzsav export: `{ __meta, ...tracker }` plus `__unbound` when the run has
 * Unbound data. Older app versions ignore unknown top-level keys' contents.
 */
export const buildExport = (meta, tracker, side) => {
  const s = normalizeSide(side)
  const hasUnbound = !!s.baseline || Object.keys(s.links).length > 0
  return { __meta: meta, ...tracker, ...(hasUnbound ? { __unbound: s } : {}) }
}

/**
 * .nzsav import: separates metadata, tracker blob and Unbound data, so
 * `__unbound` can never end up inside the tracker blob. Files from before
 * this change simply have no `__unbound`.
 */
export const splitImport = (parsed) => {
  const { __meta, __unbound, ...tracker } = parsed || {}
  return { meta: __meta, tracker, unbound: __unbound }
}

/**
 * Side data from an imported .nzsav (`__unbound`), validated against the
 * imported tracker blob. Returns null when there is nothing usable.
 */
export function sanitizeImportedSide(raw, tracker) {
  if (!isPlainObject(raw)) return null
  const side = normalizeSide(raw)
  const { links, rejected } = validateLinks(side.links, tracker)
  const linkedKeys = new Set(Object.values(links))
  const facts = Object.fromEntries(Object.entries(side.facts).filter(([key, f]) => linkedKeys.has(key) && isPlainObject(f)))
  if (!side.baseline && !Object.keys(links).length) return null
  return { side: { ...side, links, facts }, rejected }
}
