// Main-story Unbound encounter data from the Pokémon Unbound Wiki
// (CC BY-SA 4.0), merged into the app's existing route data:
//   - src/lib/data/routes.json: the `encounters` species list of each
//     documented Unbound route (unbound + unbound_exp) is rewritten to the
//     documented species, grouped by method, followed by any species only the
//     older list had (kept as an unverified fallback unless the wiki marks it
//     post-game). Route keys, order and every other field are untouched.
//   - src/lib/data/unbound/encounters.data.js: per-row details (method,
//     levels, rates, area, conditions) for those species, keyed by route key.
//
// Usage:
//   node tools/build-unbound-encounters.mjs --fetch <cache.json>   download page sources (MediaWiki API)
//   node tools/build-unbound-encounters.mjs <cache.json>           generate the data file from a cache
//
// The cache holds raw wiki page sources and is never committed; the
// generated file records each page's revision id, so a cache can be rebuilt
// for exactly the same revisions. Main story only: locations after the
// Champion in routes.json, and wiki sections marked post-game, are skipped.
import fs from 'node:fs'
import process from 'node:process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { speciesOrder } from '../src/lib/unbound/encounter-groups.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const OUT = path.join(ROOT, 'src/lib/data/unbound/encounters.data.js')
export const ROUTES = path.join(ROOT, 'src/lib/data/routes.json')
const APP_POKEMON = path.join(ROOT, 'src/routes/api/pokemon.json/_pokemon.json')

export const WIKI = 'https://pokemonunbound.miraheze.org'
const API = `${WIKI}/w/api.php`

// Route keys covered: every route before the Champion fight, except the
// starter pick (a gift, tracked separately)
export const mainStoryKeys = (routes) => {
  const champion = routes.findIndex((r) => r.type === 'gym' && r.value === 'c')
  return routes.slice(0, champion).filter((r) => r.type === 'route' && r.name !== 'Starter').map((r) => r.name)
}

// ---- Wikitext helpers

const stripMarkup = (s = '') =>
  s
    .replace(/<ref[^>]*\/>/gi, '')
    .replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\[\[(?:[^|\]]*\|)?([^\]]*)\]\]/g, '$1')
    .replace(/'{2,}/g, '')
    .replace(/\s+/g, ' ')
    .trim()

const METHODS = {
  grass: 'grass',
  cave: 'cave',
  sand: 'sand',
  walk: 'walk',
  surf: 'surf',
  dive: 'dive',
  'fish old': 'old-rod',
  'fish good': 'good-rod',
  'fish super': 'super-rod',
  'rock smash': 'rock-smash',
  tree: 'tree',
  'safari zone': 'safari',
  gift: 'gift',
  static: 'static',
  special: 'special',
  trade: 'trade',
  egg: 'egg'
}
// Methods whose 5th column is a description rather than a rate
const ONE_TIME = new Set(['gift', 'static', 'special', 'trade', 'egg'])

// catch/div labels that name an encounter kind rather than an area
const KIND_DIVS = [
  [/^(walking|fish|fishing|surfing|underwater)$/i, 'wild'],
  [/^special( encounters)?$/i, 'special'],
  [/^static( encounters)?$/i, 'static'],
  [/^gift$/i, 'gift']
]
const POST_GAME = /post[\s-]?game/i
// Area headings that are their own (post-game) route key
const OTHER_KEYS = { 'Route 11': [/^cliff cave\b/i] }
// Heading path parts that carry no area information
const NOT_AREA = /^(wild (encounters|pok[eé]mon)|pok[eé]mon|regular (encounters?|pok[eé]mon)|regular encounters)$/i

const parseLevels = (s) => {
  const range = /(\d+)\s*[–—-]\s*(\d+)/.exec(s)
  if (range) return [+range[1], +range[2]]
  const one = /^\s*(\d+)\s*$/.exec(s)
  return one ? [+one[1], +one[1]] : null
}
// "20%", or a bare "35"; anything else ("X%", "???") is unknown
const parseRate = (s) => {
  const m = /^\s*(\d+(?:\.\d+)?)\s*%?\s*$/.exec(s || '') || /(\d+(?:\.\d+)?)\s*%/.exec(s || '')
  return m ? +m[1] : null
}

// ---- Species

const norm = (s) =>
  String(s)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/♀/g, 'f')
    .replace(/♂/g, 'm')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')

const REGIONAL_PREFIX = { alolan: 'alola', galarian: 'galar', hisuian: 'hisui', paldean: 'paldea' }
const REGIONAL_SUFFIX = { A: 'alola', G: 'galar', Ga: 'galar', H: 'hisui' }
// Misspelt species names on the wiki (checked against the dex number column)
const WIKI_TYPOS = {
  mincinno: 'Minccino',
  carvahna: 'Carvanha',
  sligoo: 'Sliggoo',
  tranquil: 'Tranquill',
  amoongus: 'Amoonguss'
}
// Dex-suffix forms that are a distinct tracker alias
const FORM_ALIAS = { '876F': 'indeedee-f' }

export const speciesResolver = (appPokemon) => {
  const aliases = new Set(appPokemon.map((p) => p.alias))
  // Forms share a name in the tracker data (Oricorio -> oricorio,
  // oricorio-pau, ...): prefer the alias that is just the name
  const byName = new Map()
  for (const p of appPokemon) if (norm(p.alias) === norm(p.name)) byName.set(norm(p.name), p.alias)
  for (const p of appPokemon) if (!byName.has(norm(p.name))) byName.set(norm(p.name), p.alias)
  const formAlias = (base, form) => {
    if (!form) return null
    const a = `${base}-${String(form).toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`
    return aliases.has(a) ? a : null
  }

  return (dexField, wikiName, formArg) => {
    let name = stripMarkup(wikiName).replace(/️/g, '')
    // In-game trades give a nickname: "Ducklett (Quacker)"
    const nick = /^(.*?)\s*\(([^)]*)\)\s*$/.exec(name)
    if (nick) name = nick[1]
    name = WIKI_TYPOS[norm(name)] || name
    let region = null
    const pre = /^(Alolan|Galarian|Hisuian|Paldean)\s+/i.exec(name)
    if (pre) {
      region = REGIONAL_PREFIX[pre[1].toLowerCase()]
      name = name.slice(pre[0].length)
    }
    const dex = String(dexField).trim()
    const suffix = /^\d+(\D*)$/.exec(dex)?.[1] || ''

    const base = byName.get(norm(name.replace(/[♀♂]$/, ''))) || byName.get(norm(name))
    if (!base) return null
    const nickname = nick ? nick[2] : undefined
    const special = FORM_ALIAS[dex]
    if (special && aliases.has(special)) return { species: special, form: null, nickname }
    // Regional forms: "Alolan X", or a dex suffix (027A) when that form exists
    const regional = formAlias(base, region || REGIONAL_SUFFIX[suffix])
    if (regional) return { species: regional, form: null, nickname }
    // Named forms with their own tracker alias (form=Pa'u -> oricorio-pau)
    const named = formAlias(base, formArg)
    if (named) return { species: named, form: null, nickname }
    // Other forms keep the base species; only a form the wiki names (form=)
    // is recorded - dex suffix letters (550R, 905I, 669Y) are wiki codes
    return { species: base, form: formArg || null, nickname }
  }
}

// ---- Page parsing

/**
 * @returns {{ areas: Array, swarms: Array, postGame: string[], unresolved: string[], skippedAreas: string[] }}
 *   postGame: species the page lists only in post-game sections/rows
 */
export function parsePage(title, text, resolve) {
  const areas = []
  const swarms = []
  const unresolved = []
  const skippedAreas = new Set()
  const postGame = new Set()
  const heads = []
  let current = null // { area, skip, rows }
  let divArea = null,
    kind = 'wild'

  const areaName = () => {
    const parts = heads.filter(Boolean).map(stripMarkup).filter((h) => !NOT_AREA.test(h))
    if (divArea) parts.push(divArea)
    return parts.join(' - ') || null
  }
  // Tables under a "Special Encounters" heading are one-off encounters
  const headingKind = () => (heads.some((x) => /special encounters/i.test(x || '')) ? 'special' : 'wild')
  const skipArea = (name) =>
    !!name && (POST_GAME.test(name) || (OTHER_KEYS[title] || []).some((re) => re.test(name)))

  const target = () => {
    const area = areaName()
    if (!current || current.area !== area) {
      current = { area, skip: skipArea(area), rows: [] }
      if (current.skip) skippedAreas.add(area)
      else areas.push(current)
    }
    return current
  }

  for (const line of text.split('\n')) {
    const h = /^(=+)\s*(.*?)\s*\1\s*$/.exec(line)
    if (h) {
      heads[h[1].length] = h[2]
      heads.length = h[1].length + 1
      divArea = null
      kind = headingKind()
      continue
    }
    if (/\{\{\s*catch\/header/i.test(line)) {
      divArea = null
      kind = headingKind()
      continue
    }
    const div = /\{\{\s*catch\/div\s*\|[^|}]*\|([^}]*)\}\}/i.exec(line)
    if (div) {
      const label = stripMarkup(div[1])
      const k = KIND_DIVS.find(([re]) => re.test(label))
      if (k) {
        kind = k[1] === 'wild' ? headingKind() : k[1]
      } else {
        // "Walking (West and Small Islands)", "Fishing on East Island", "1F"
        const sub = /^(?:walking|surfing|fishing)\s*(?:\((.*)\)|on\s+(.*))$/i.exec(label)
        divArea = sub ? sub[1] || sub[2] : label
        kind = headingKind()
      }
      continue
    }
    const swarm = /\{\{\s*Swarm\/head\s*\|[^|}]*\|([^|}]*)\|([^|}]*)\}\}/i.exec(line)
    if (swarm) {
      const s = resolve(swarm[1], swarm[2])
      const area = areaName()
      if (skipArea(area)) {
        if (s) postGame.add(s.species)
        continue
      }
      if (!s) unresolved.push(`${title}: swarm ${swarm[2]}`)
      else swarms.push({ species: s.species, ...(s.form ? { form: s.form } : {}) })
      continue
    }
    const entry = /\{\{\s*catch\/entry(Timed|AllDay)\s*\|([^}]*)\}\}/i.exec(line)
    if (!entry) continue

    const args = entry[2].split('|')
    const named = Object.fromEntries(
      args.filter((a) => /^\s*[\w-]+\s*=/.test(a)).map((a) => a.split('=').map((x) => x.trim()))
    )
    const pos = args.filter((a) => !/^\s*[\w-]+\s*=/.test(a)).map((a) => a.trim())
    const timed = entry[1].toLowerCase() === 'timed'
    const [dex, wikiName, rawMethod, rawLevels] = pos
    const t = target()
    const s = resolve(dex, wikiName, named.form)
    if (!s) {
      unresolved.push(`${title}: ${wikiName}`)
      continue
    }
    if (t.skip) {
      postGame.add(s.species)
      continue
    }
    const method = METHODS[(rawMethod || '').toLowerCase()] || null
    if (!method) unresolved.push(`${title}: method "${rawMethod}" for ${wikiName}`)
    const rowKind = ONE_TIME.has(method) ? method : kind

    const row = { species: s.species }
    if (s.form) row.form = s.form
    if (s.nickname) row.nickname = s.nickname
    row.method = method
    row.kind = rowKind
    row.levels = parseLevels(rawLevels || '')
    // An impossible range ("45–40") is a wiki typo: keep it unknown, not guessed
    if (row.levels && row.levels[0] > row.levels[1]) {
      unresolved.push(`${title}: ${wikiName} levels "${rawLevels}" (kept as unknown)`)
      row.levels = null
      row.levelsNote = `Wiki lists "${stripMarkup(rawLevels)}"`
    }
    if (ONE_TIME.has(method) || rowKind !== 'wild') {
      const note = stripMarkup(timed ? pos.slice(4).join(' / ') : pos[4] || '')
      if (note && !/^\d+(\.\d+)?%$/.test(note)) row.note = note
      const rate = parseRate(pos[4])
      if (rate != null && rowKind === 'wild') row.rate = { all: rate }
    } else if (timed) {
      row.rate = { day: parseRate(pos[4]), night: parseRate(pos[5]) }
    } else {
      row.rate = { all: parseRate(pos[4]) }
    }
    // Rows whose own note marks them post-game ("Kyurem's cave, Post Game")
    // ("7.14% (pre-Post Game), 6.66% (Post Game)" is available before it)
    if (row.note && POST_GAME.test(row.note) && !/pre[\s-]?post[\s-]?game/i.test(row.note)) {
      skippedAreas.add(`${t.area ? `${t.area}: ` : ''}${row.species} (${row.note})`)
      postGame.add(row.species)
      continue
    }
    t.rows.push(row)
  }

  return {
    areas: areas.filter((a) => a.rows.length).map(({ area, rows }) => ({ area, encounters: rows })),
    swarms,
    postGame: [...postGame],
    unresolved,
    skippedAreas: [...skippedAreas]
  }
}

// ---- Fetch / generate

export async function fetchPages(titles) {
  const pages = {}
  for (let i = 0; i < titles.length; i += 40) {
    const batch = titles.slice(i, i + 40)
    const url = `${API}?action=query&format=json&formatversion=2&prop=revisions&rvprop=ids|timestamp|content&rvslots=main&titles=${encodeURIComponent(batch.join('|'))}`
    const res = await fetch(url, { headers: { 'User-Agent': 'nuzlocke-unbound-companion (data import)' } })
    if (!res.ok) throw new Error(`${res.status} ${url}`)
    const { query } = await res.json()
    for (const p of query.pages) {
      if (p.missing) continue
      const rev = p.revisions[0]
      pages[p.title] = { revid: rev.revid, timestamp: rev.timestamp, content: rev.slots.main.content }
    }
  }
  return { fetched: new Date().toISOString(), pages }
}

export function build(cache, { routes, appPokemon }) {
  const resolve = speciesResolver(appPokemon)
  const locations = {}
  const report = { missingPages: [], unresolved: [], skippedAreas: {}, empty: [] }

  for (const key of mainStoryKeys(routes)) {
    const page = cache.pages[key]
    if (!page) {
      report.missingPages.push(key)
      continue
    }
    const parsed = parsePage(key, page.content, resolve)
    report.unresolved.push(...parsed.unresolved)
    if (parsed.skippedAreas.length) report.skippedAreas[key] = parsed.skippedAreas
    if (!parsed.areas.length && !parsed.swarms.length) {
      report.empty.push(key)
      continue
    }
    // Species the page lists only after the main story (kept so older data
    // listing them can be explained rather than flagged unverified)
    const mainSpecies = new Set(parsed.areas.flatMap((a) => a.encounters.map((e) => e.species)))
    const postGame = parsed.postGame.filter((sp) => !mainSpecies.has(sp))
    const rows = [
      ...parsed.areas.flatMap((a) => a.encounters.map((e) => (a.area ? { ...e, area: a.area } : e))),
      ...parsed.swarms.map((s) => ({ ...s, method: 'swarm', kind: 'swarm', levels: null }))
    ]
    locations[key] = {
      page: key,
      revid: page.revid,
      rows,
      ...(postGame.length ? { postGame } : {})
    }
  }
  return { locations, report }
}

// A list entry is covered by the documented species when they include it or
// one of its forms (older "oricorio" vs documented "oricorio-baile")
const covered = (set, alias) => set.has(alias) || [...set].some((s) => s.startsWith(`${alias}-`))

/**
 * New `encounters` list for one documented route: documented species in
 * picker order, then the old list's other species unless the wiki lists them
 * only post-game. Idempotent: re-running on its own output changes nothing.
 */
export const enrichedList = (oldList = [], loc) => {
  const documented = speciesOrder(loc.rows)
  const set = new Set(documented)
  const postGame = new Set(loc.postGame || [])
  const fallback = oldList.filter((s) => !covered(set, s) && !postGame.has(s))
  return [...new Set([...documented, ...fallback])]
}

/** routes.json with the documented Unbound lists rewritten (nothing else changes) */
export const enrichRoutes = (allRoutes, locations) => {
  const out = { ...allRoutes }
  for (const game of ['unbound', 'unbound_exp'])
    out[game] = allRoutes[game].map((r) =>
      r.type === 'route' && locations[r.name] ? { ...r, encounters: enrichedList(r.encounters, locations[r.name]) } : r
    )
  return out
}

export const render = (cache, locations) => `// Generated by tools/build-unbound-encounters.mjs - do not edit by hand.
//
// Wild encounter data adapted from the Pokémon Unbound Wiki
// (${WIKI}), by its contributors, licensed CC BY-SA 4.0
// (https://creativecommons.org/licenses/by-sa/4.0/). Changes: parsed into
// structured records, species mapped to tracker aliases, post-game sections
// removed. This file is distributed under the same license.
//
// { [routeKey]: { page, revid, rows: [{ species, form?, nickname?, method,
//   kind, levels: [min,max]|null, levelsNote?, rate?: {all}|{day,night},
//   area?, note? }], postGame?: [species the page lists only post-game] } }
// Every row's species is in that route's "encounters" list in routes.json.
export default ${JSON.stringify({ source: WIKI, license: 'CC BY-SA 4.0', fetched: cache.fetched, locations }, null, 1)};
`

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const routes = JSON.parse(fs.readFileSync(ROUTES, 'utf8')).unbound
  const args = process.argv.slice(2)
  if (args[0] === '--fetch') {
    if (!args[1]) throw new Error('Usage: --fetch <cache.json>')
    const cache = await fetchPages(mainStoryKeys(routes))
    fs.writeFileSync(args[1], JSON.stringify(cache))
    console.log(`Fetched ${Object.keys(cache.pages).length} pages -> ${args[1]}`)
  } else {
    if (!args[0]) throw new Error('Usage: node tools/build-unbound-encounters.mjs [--fetch] <cache.json>')
    const cache = JSON.parse(fs.readFileSync(args[0], 'utf8'))
    const appPokemon = JSON.parse(fs.readFileSync(APP_POKEMON, 'utf8'))
    const { locations, report } = build(cache, { routes, appPokemon })
    fs.writeFileSync(OUT, render(cache, locations))
    console.log(`Wrote ${path.relative(ROOT, OUT)}: ${Object.keys(locations).length} locations`)
    // routes.json is stored as JSON.stringify(_, null, 2) with no trailing newline
    const all = JSON.parse(fs.readFileSync(ROUTES, 'utf8'))
    fs.writeFileSync(ROUTES, JSON.stringify(enrichRoutes(all, locations), null, 2))
    console.log(`Updated ${path.relative(ROOT, ROUTES)} (unbound, unbound_exp encounter lists)`)
    console.log(JSON.stringify(report, null, 1))
  }
}
