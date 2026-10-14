// Checks the app's main-story Unbound boss teams (src/lib/data/league.json)
// against the Pokémon Unbound Wiki and writes the result to
// src/lib/data/unbound/bosses.verification.data.js. Read-only for league.json:
// differences are reported, never applied.
//
// Usage:
//   node tools/verify-unbound-bosses.mjs --fetch <cache.json>   download boss page sources (MediaWiki API)
//   node tools/verify-unbound-bosses.mjs <cache.json>           compare and write the verification file
//
// The app's Normal teams (key) are compared with the wiki's "Difficult"
// teams and its Expert teams (key_exp) with "Expert". Rival teams depend on
// the player's starter: app starter "fire" = player chose Gible, "water" =
// Beldum, "grass" = Larvitar (src/lib/components/starter-type.svelte).
import fs from 'node:fs'
import process from 'node:process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const OUT = path.join(ROOT, 'src/lib/data/unbound/bosses.verification.data.js')
const LEAGUE = path.join(ROOT, 'src/lib/data/league.json')
const ROUTES = path.join(ROOT, 'src/lib/data/routes.json')
const APP_POKEMON = path.join(ROOT, 'src/routes/api/pokemon.json/_pokemon.json')
const WIKI = 'https://pokemonunbound.miraheze.org'

// App boss key -> where the battle is on the wiki. `heading` is the section
// the battle sits under; `location` the template's location field.
export const BATTLES = {
  r1: { page: 'Ace', heading: 'Frozen Heights' },
  r2: { page: 'Ace', heading: 'Icicle Cave' },
  r3: { page: 'Ace', heading: 'Frost Mountain' },
  r4: { page: 'Ace', heading: 'Route 12' },
  r5: { page: 'Ace', heading: 'Cootes Bog' },
  1: { page: 'Mirskle', location: 'Dresco Town' },
  2: { page: 'Véga', location: 'Crater Town' },
  3: { page: 'Alice', location: 'Blizzard City' },
  4: { page: 'Mel', location: 'Fallshore City' },
  5: { page: 'Galavan', location: 'Dehara City' },
  6: { page: 'Big Mo', location: 'Antisis City' },
  7: { page: 'Tessy', location: 'Polder Town' },
  8: { page: 'Benjamin', location: 'Redwood Village' },
  e1: { page: 'Moleman', location: 'Pokémon League' },
  e2: { page: 'Elias', location: 'Pokémon League' },
  e3: { page: 'Arabella', location: 'Pokémon League' },
  e4: { page: 'Penny', location: 'Pokémon League' },
  c: { page: 'Jax', heading: 'Pokémon League' },
  mb1: { page: 'Maxima', location: 'Tarmigan Mansion' },
  sh1: { page: 'Marlon', heading: 'Cinder Volcano' },
  sh2: { page: 'Ivory', heading: 'Cinder Volcano' },
  sh3: { page: 'Zeph', heading: 'Cinder Volcano' },
  sh4: { page: 'Ivory', heading: 'Route 9' },
  sh5: { page: 'Marlon', heading: 'Thundercap Mt.' },
  sh6: { page: 'Zeph', heading: 'Shadow Base' },
  lr1: { page: 'Véga', heading: 'Cinder Volcano' },
  lr2: { page: 'Aklove', heading: 'Vivill Town' },
  lr3: { page: 'Ivory', heading: 'Crystal Peak' },
  lr4: { page: 'Aklove', heading: 'Crystal Peak' },
  sh7: { page: 'Marlon', heading: 'Crystal Peak' }
}
// After the Champion in routes.json: out of scope for the main story
export const POST_GAME = ['lr5']

const STARTER_TAB = { gible: 'fire', beldum: 'water', larvitar: 'grass' }
// The wiki says the rival's levels (and so evolutions) follow Level Scaling
export const LEVEL_SCALED = ['r1', 'r2', 'r3', 'r4', 'r5']
// Misspellings on the wiki (moves/abilities), so they aren't reported as differences
const WIKI_TYPOS = { fail: 'flail', dazzlinggeam: 'dazzlinggleam', below: 'bellow' }
const DIFFICULTY = { '': 'Difficult', _exp: 'Expert' }

export const PAGES = [...new Set(Object.values(BATTLES).map((b) => b.page))]

const norm = (s = '') =>
  String(s)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')

// ---- Wiki parsing

// Template fields appear both as "|level=21" and "| level = 21"
const field = (block, k) => (new RegExp(`\\|\\s*${k}\\s*=\\s*([^\\n|}]*)`).exec(block) || [])[1]?.trim() || ''

/** Every Party/Single or Party/Tag battle on a page, with its section and starter tab */
export function parseBattles(text) {
  const lines = text.split('\n')
  const out = []
  let heading = '',
    tab = ''
  for (let i = 0; i < lines.length; i++) {
    const h = /^(=+)\s*(.*?)\s*\1\s*$/.exec(lines[i])
    if (h) {
      heading = h[2]
      tab = ''
      continue
    }
    const t = /^\|-\|(.*)=\s*$/.exec(lines[i])
    if (t) tab = t[1].trim()
    const party = /\{\{Party\/(Single|Tag)\b/.exec(lines[i])
    if (!party) continue
    // The battle runs to its {{Party/Footer}}
    let j = i
    while (j < lines.length && !/\{\{Party\/Footer/.test(lines[j])) j++
    const block = lines.slice(i, j).join('\n')
    const header = block.slice(0, block.indexOf('\n}}') + 3)
    const mons = [...block.matchAll(/\{\{Pokémon\/TrainerBoss([\s\S]*?)\}\}/g)].map(([, m]) => ({
      species: field(m, 'pokemon'),
      form: field(m, 'form'),
      level: Number(field(m, 'level')) || null,
      ability: field(m, 'ability'),
      held: field(m, 'held'),
      moves: [1, 2, 3, 4].map((n) => field(m, `move${n}`)).filter(Boolean)
    }))
    out.push({
      type: party[1].toLowerCase(),
      heading,
      tab,
      difficulty: field(header, 'difficulty'),
      location: field(header, 'location'),
      mons
    })
    i = j
  }
  return out
}

const hasDifficulty = (text, wanted) =>
  new RegExp(`\\b${wanted}\\b`, 'i').test(text) && !/^(any)$/i.test(text.trim())

/** The wiki battle for one app key + difficulty (+ starter for rivals) */
export function findBattle(battles, spec, difficulty, starter) {
  const matches = battles.filter(
    (b) =>
      (!spec.heading || b.heading === spec.heading) &&
      (!spec.location || b.location === spec.location) &&
      hasDifficulty(b.difficulty, difficulty) &&
      (!starter || STARTER_TAB[norm(b.tab.replace(/^if the player chose /i, ''))] === starter)
  )
  return matches
}

// ---- Comparison

const fix = (s) => WIKI_TYPOS[norm(s)] || norm(s)
// "Hidden Power" on the wiki carries no type; any hidden-power-* matches it
const move = (s) => (/^hiddenpower/.test(norm(s)) ? 'hiddenpower' : fix(s))

export function compareTeam(appMons, wikiMons, nameOf) {
  const diffs = []
  const pool = [...wikiMons]
  for (const m of appMons) {
    // App aliases carry forms (rotom-fan, golem-alola); the wiki has
    // species + form (Rotom, -Fan): exact form first, then the base species
    // (cosmetic or battle forms such as Floette-Blue, Lopunny-Mega).
    const keys = new Set([norm(m.name), norm(nameOf(m.name))])
    let i = pool.findIndex((w) => keys.has(norm(w.species + w.form)))
    if (i < 0) i = pool.findIndex((w) => keys.has(norm(w.species)))
    if (i < 0) {
      diffs.push(`${m.name}: not in the wiki team`)
      continue
    }
    const w = pool.splice(i, 1)[0]
    if (Number(m.level) !== w.level) diffs.push(`${m.name}: level ${m.level} (wiki ${w.level})`)
    const appMoves = m.moves || []
    if (new Set(appMoves).size !== appMoves.length) diffs.push(`${m.name}: app lists a move twice (${appMoves.join('/')})`)
    const am = [...new Set(appMoves.map(move))].sort()
    const wm = [...new Set(w.moves.map(move))].sort()
    if (am.join() !== wm.join()) diffs.push(`${m.name}: moves ${appMoves.join('/')} (wiki ${w.moves.join('/')})`)
    if (m.ability && fix(m.ability) !== fix(w.ability)) diffs.push(`${m.name}: ability ${m.ability} (wiki ${w.ability})`)
    if (norm(m.held || '') !== norm(w.held || ''))
      diffs.push(`${m.name}: held ${m.held || 'none'} (wiki ${w.held || 'none'})`)
  }
  for (const w of pool) diffs.push(`${w.species}: in the wiki team, missing from the app`)
  return diffs
}

export function verify(cache, { league, routes, appPokemon }) {
  const byAlias = new Map(appPokemon.map((p) => [p.alias, p]))
  const nameOf = (alias) => byAlias.get(alias)?.name || alias
  const parsed = Object.fromEntries(Object.entries(cache.pages).map(([t, p]) => [t, parseBattles(p.content)]))
  const location = Object.fromEntries(routes.filter((r) => r.type === 'gym').map((r) => [r.value, r.name]))
  const result = {}

  for (const [base, spec] of Object.entries(BATTLES)) {
    for (const [suffix, difficulty] of Object.entries(DIFFICULTY)) {
      const key = base + suffix
      const boss = league[key]
      const page = cache.pages[spec.page]
      const entry = { page: spec.page, revid: page?.revid ?? null, wikiDifficulty: difficulty, appLocation: location[base] || null }
      if (!boss) {
        result[key] = { ...entry, status: 'missing-in-app' }
        continue
      }
      if (!page) {
        result[key] = { ...entry, status: 'unsupported', reason: 'no wiki page' }
        continue
      }
      const starters = [...new Set(boss.pokemon.map((p) => p.starter).filter(Boolean))]
      const variants = starters.length ? starters : [null]
      const diffs = []
      let found = 0
      for (const starter of variants) {
        const battles = findBattle(parsed[spec.page], spec, difficulty, starter)
        const label = starter ? `[${starter}] ` : ''
        if (battles.length !== 1) {
          diffs.push(`${label}${battles.length ? `${battles.length} matching wiki battles` : 'no matching wiki battle'}`)
          continue
        }
        found++
        const mons = boss.pokemon.filter((p) => !p.starter || p.starter === starter)
        diffs.push(...compareTeam(mons, battles[0].mons, nameOf).map((d) => label + d))
        if (!entry.wikiLocation) entry.wikiLocation = battles[0].location
      }
      result[key] = {
        ...entry,
        ...(LEVEL_SCALED.includes(base) ? { levelScaled: true } : {}),
        status: !found ? 'unsupported' : diffs.length ? 'differs' : 'verified',
        ...(diffs.length ? { diffs } : {})
      }
    }
  }
  for (const key of POST_GAME) for (const suffix of Object.keys(DIFFICULTY)) result[key + suffix] = { status: 'post-game', reason: 'not verified (V1 = main story)' }
  return result
}

export async function fetchPages(titles = PAGES) {
  const url = `${WIKI}/w/api.php?action=query&format=json&formatversion=2&prop=revisions&rvprop=ids|timestamp|content&rvslots=main&titles=${encodeURIComponent(titles.join('|'))}`
  const res = await fetch(url, { headers: { 'User-Agent': 'nuzlocke-unbound-companion (data import)' } })
  if (!res.ok) throw new Error(`${res.status} ${url}`)
  const { query } = await res.json()
  const pages = {}
  for (const p of query.pages) {
    if (p.missing) continue
    const rev = p.revisions[0]
    pages[p.title] = { revid: rev.revid, timestamp: rev.timestamp, content: rev.slots.main.content }
  }
  return { fetched: new Date().toISOString(), pages }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  if (args[0] === '--fetch') {
    if (!args[1]) throw new Error('Usage: --fetch <cache.json>')
    const cache = await fetchPages()
    fs.writeFileSync(args[1], JSON.stringify(cache))
    console.log(`Fetched ${Object.keys(cache.pages).length}/${PAGES.length} pages -> ${args[1]}`)
  } else {
    if (!args[0]) throw new Error('Usage: node tools/verify-unbound-bosses.mjs [--fetch] <cache.json>')
    const cache = JSON.parse(fs.readFileSync(args[0], 'utf8'))
    const result = verify(cache, {
      league: JSON.parse(fs.readFileSync(LEAGUE, 'utf8')).unbound,
      routes: JSON.parse(fs.readFileSync(ROUTES, 'utf8')).unbound,
      appPokemon: JSON.parse(fs.readFileSync(APP_POKEMON, 'utf8'))
    })
    const out = { source: WIKI, license: 'CC BY-SA 4.0', fetched: cache.fetched, bosses: result }
    fs.writeFileSync(
      OUT,
      `// Generated by tools/verify-unbound-bosses.mjs - do not edit by hand.
// How each app boss team (league.json) compares with the Pokémon Unbound Wiki
// (${WIKI}, CC BY-SA 4.0): Normal = wiki "Difficult", Expert = "Expert".
// status: verified | differs (diffs lists each difference) | unsupported | post-game
export default ${JSON.stringify(out, null, 2)};
`
    )
    const count = (s) => Object.values(result).filter((r) => r.status === s).length
    console.log(`Wrote ${path.relative(ROOT, OUT)}: verified ${count('verified')}, differs ${count('differs')}, unsupported ${count('unsupported')}, post-game ${count('post-game')}`)
  }
}
