// Compares (and, with --apply, imports) main-story Unbound boss teams from
// the "Pokémon Unbound 2.1.1.1 Trainers Doc" workbooks into
// src/lib/data/league.json.
//
// Usage:
//   python3 -I tools/xlsx-to-json.py "<Difficult Bosses.xlsx>" <difficult.json>
//   node tools/import-unbound-bosses.mjs --difficult <difficult.json> [--apply]
//        [--sha256 <workbook sha256>] [--retrieved <YYYY-MM-DD>]
// Without --apply only the check file (bosses.trainer-doc.data.js) is written.
//
// Difficult workbook -> the app's Normal teams (key); an Expert workbook
// (key_exp) is not supported until one is provided - Difficult and Expert
// rosters differ. Rival starter variants: the workbook's "PLAYER CHOSE
// GIBLE / BELDUM / LARVITAR" columns = app starter fire / water / grass.
// Partner teams in tag battles are ignored; the grunt half of an admin +
// grunt tag battle is part of the app's boss team.
import fs from 'node:fs'
import process from 'node:process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const LEAGUE = path.join(ROOT, 'src/lib/data/league.json')
export const CHECK_OUT = path.join(ROOT, 'src/lib/data/unbound/bosses.trainer-doc.data.js')

// The workbook this importer was written against (recorded in the check file)
export const DIFFICULT_DOC = {
  title: 'Pokémon Unbound 2.1.1.1 Trainers Doc - Difficult Bosses [WIP]',
  gameVersion: '2.1.1.1',
  difficulty: 'Difficult',
  appTeams: 'Normal (league.json key without _exp)'
}
const APP_POKEMON = path.join(ROOT, 'src/routes/api/pokemon.json/_pokemon.json')

const norm = (s = '') =>
  String(s)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
const slug = (s = '') =>
  String(s)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’.]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

const STARTER_COLUMN = { gible: 'fire', beldum: 'water', larvitar: 'grass' }

// Workbook battle -> app boss key. `title` matches a column footer label
// (before " - Difficult"); rivals are matched by their Location row.
export const DIFFICULT_BATTLES = {
  1: { sheet: 'Gym Leaders', title: 'Leader Mirskle' },
  2: { sheet: 'Gym Leaders', title: 'Leader Vega' },
  3: { sheet: 'Gym Leaders', title: 'Leader Alice' },
  4: { sheet: 'Gym Leaders', title: 'Leader Mel' },
  mb1: { sheet: 'Gym Leaders', title: 'Sucessor Maxima' },
  5: { sheet: 'Gym Leaders', title: 'Leader Galavan' },
  6: { sheet: 'Gym Leaders', title: 'Leader Big Mo' },
  7: { sheet: 'Gym Leaders', title: 'Leader Tessy' },
  8: { sheet: 'Gym Leaders', title: 'Leader Benjamin' },
  e1: { sheet: 'Pokemon League', title: 'Elite Four Moleman' },
  e2: { sheet: 'Pokemon League', title: 'Elite Four Elias' },
  e3: { sheet: 'Pokemon League', title: 'Elite Four Arabella' },
  e4: { sheet: 'Pokemon League', title: 'Elite Four Penny' },
  c: { sheet: 'Pokemon League', title: 'Champion Jax' },
  sh1: { sheet: 'Team Shadow Bosses', title: ['Shadow Admin Marlon 1', 'Shadow Grunt w/ Marlon 1'] },
  sh2: { sheet: 'Team Shadow Bosses', title: 'Shadow Admin Ivory 1' },
  sh3: { sheet: 'Team Shadow Bosses', title: 'Boss Zeph 1' },
  sh4: { sheet: 'Team Shadow Bosses', title: ['Shadow Admin Ivory 2', 'Shadow Grunt w/ Ivory 2'] },
  sh5: { sheet: 'Team Shadow Bosses', title: 'Shadow Admin Marlon 2' },
  sh6: { sheet: 'Team Shadow Bosses', title: 'Boss Zeph 2' },
  sh7: { sheet: 'Team Shadow Bosses', title: 'Shadow Admin Marlon 3' },
  lr1: { sheet: 'Team Light Of Ruin Bosses', title: ['Light of Ruin Vega', 'Light of Ruin Grunt w/ Vega'] },
  lr2: { sheet: 'Team Light Of Ruin Bosses', title: 'Light of Ruin Aklove 1' },
  lr3: { sheet: 'Team Light Of Ruin Bosses', title: 'Light of Ruin Admin Ivory 3' },
  lr4: { sheet: 'Team Light Of Ruin Bosses', title: 'Light of Ruin Aklove 2' },
  r1: { sheet: 'Rival', location: 'Frozen Heights' },
  r2: { sheet: 'Rival', location: 'Icicle Cave 2F' },
  r3: { sheet: 'Rival', location: 'Frost Mountain' },
  r4: { sheet: 'Rival', location: 'Route 12' },
  r5: { sheet: 'Rival', location: 'Cootes Bog' }
}
// Rival battles follow Level Scaling: levels and level-based evolutions are
// not compared or imported
export const LEVEL_SCALED = ['r1', 'r2', 'r3', 'r4', 'r5']

// ---- Workbook parsing

const cell = (row, c) => (row?.cells?.[c] ?? '').toString().trim()
const num = (v) => (v === '' ? null : Math.round(Number(v)))

/**
 * Every Pokémon column of every battle block on a sheet:
 * { col, footer, location, group, species, level, levelKind, ability, held, moves, nature }
 */
export function parseSheet(sheet) {
  const rows = sheet.rows
  const byNum = new Map(rows.map((r) => [r.row, r]))
  const groupHeads = rows.find((r) => Object.values(r.cells).some((v) => /^PLAYER CHOSE /i.test(v)))
  const groupOf = (col) => {
    if (!groupHeads) return null
    let best = null
    for (const [c, v] of Object.entries(groupHeads.cells)) if (+c <= col && /^PLAYER CHOSE /i.test(v)) best = v
    return best ? STARTER_COLUMN[norm(best.replace(/^PLAYER CHOSE /i, ''))] : null
  }
  const out = []
  for (const r of rows) {
    if (cell(r, 0) !== 'Pokemon Names') continue
    const at = (label, from = r.row, span = 8) => {
      for (let n = from; n < from + span; n++) if (cell(byNum.get(n), 0) === label) return byNum.get(n)
      return null
    }
    const levelRow = at('Level at Cap') || at('Minimum Level')
    const ability = at('Ability')
    const held = at('Held Item')
    const moves = at('Moves')
    const nature = at('Nature', r.row, 14)
    // Footer: first row after the block whose cells carry " - Difficult"/"[Difficult]"
    let footer = null
    for (let n = r.row + 1; n < r.row + 20; n++) {
      const fr = byNum.get(n)
      if (fr && !cell(fr, 0) && Object.values(fr.cells).some((v) => /difficult/i.test(v))) {
        footer = fr
        break
      }
    }
    // Location (rivals): nearest "Location" row above
    let location = null
    for (let n = r.row - 1; n > r.row - 8; n--) if (cell(byNum.get(n), 0) === 'Location') location = byNum.get(n)
    for (const c of Object.keys(r.cells).map(Number).filter((c) => c > 0)) {
      const species = cell(r, c)
      if (!species) continue
      out.push({
        col: c,
        footer: footer ? cell(footer, c).replace(/\s*(-\s*Difficu?l?t?|\[Difficult\])\s*$/i, '').trim() : '',
        location: location ? cell(location, groupStart(location, c)) : '',
        group: groupOf(c),
        species,
        level: levelRow ? num(cell(levelRow, c)) : null,
        levelKind: levelRow ? cell(levelRow, 0) : null,
        ability: ability ? cell(ability, c) : '',
        held: held ? cell(held, c) : '',
        moves: moves ? [0, 1, 2, 3].map((i) => cell(byNum.get(moves.row + i), c)).filter(Boolean) : [],
        nature: nature ? cell(nature, c) : ''
      })
    }
  }
  return out
}
// Rival Location rows only fill the first column of each starter group
const groupStart = (row, col) => {
  const cols = Object.keys(row.cells).map(Number).filter((c) => c > 0 && c <= col)
  return cols.length ? Math.max(...cols) : col
}

// "Duskull [Marlon's lead]" -> { species: 'Duskull', mega: false, region }
export function parseSpecies(raw) {
  let name = raw.replace(/\s*\[[^\]]*\]\s*/g, ' ').trim()
  const mega = /^Mega\s+/i.test(name)
  if (mega) name = name.replace(/^Mega\s+/i, '')
  const region = /^(Alolan|Galarian|Hisuian)\s+/i.exec(name)
  if (region) name = name.slice(region[0].length)
  return { species: name, mega, region: region ? { alolan: 'alola', galarian: 'galar', hisuian: 'hisui' }[region[1].toLowerCase()] : null }
}

export function docTeam(parsed, spec, starter) {
  const titles = [].concat(spec.title || [])
  return parsed.filter((m) =>
    spec.location
      ? m.location === spec.location && m.group === starter && m.col % 7 !== 0
      : titles.includes(m.footer)
  )
}

// ---- Comparison

export function compare(appMons, docMons, { nameOf, levelScaled }) {
  const diffs = []
  const pool = docMons.map((d) => ({ ...d, ...parseSpecies(d.species) }))
  for (const m of appMons) {
    const keys = new Set([norm(m.name), norm(nameOf(m.name))])
    const i = pool.findIndex((d) => keys.has(norm(d.species)) || keys.has(norm(`${d.species}${d.region || ''}`)))
    if (i < 0) {
      diffs.push({ mon: m.name, field: 'species', app: m.name, doc: null })
      continue
    }
    const d = pool.splice(i, 1)[0]
    if (!levelScaled && d.level != null && Number(m.level) !== d.level) diffs.push({ mon: m.name, field: 'level', app: Number(m.level), doc: d.level })
    // The workbook repeats a move to fill an empty slot ("Metal Claw, Metal Claw")
    const am = [...new Set((m.moves || []).map(norm))].sort()
    const docMoves = [...new Set(d.moves.filter((x) => !/default moveset/i.test(x)))]
    const dm = [...new Set(docMoves.map(norm))].sort()
    if (dm.length && am.join() !== dm.join()) diffs.push({ mon: m.name, field: 'moves', app: m.moves, doc: docMoves })
    // "Lightning Rod → Intimidate": base ability, then the Mega's; "A / B": either
    const abilities = d.ability.split('→')[0].split('/').map(norm).filter(Boolean)
    if (abilities.length && !abilities.includes(norm(m.ability))) diffs.push({ mon: m.name, field: 'ability', app: m.ability || null, doc: d.ability })
    if (norm(m.held || '') !== norm(d.held || '')) diffs.push({ mon: m.name, field: 'held', app: m.held || null, doc: d.held || null })
  }
  for (const d of pool) diffs.push({ mon: d.species, field: 'species', app: null, doc: d.species })
  return diffs
}

export function compareAll(doc, league, appPokemon) {
  const byAlias = new Map(appPokemon.map((p) => [p.alias, p]))
  const nameOf = (alias) => byAlias.get(alias)?.name || alias
  const parsed = {}
  const out = {}
  for (const [key, spec] of Object.entries(DIFFICULT_BATTLES)) {
    parsed[spec.sheet] ||= parseSheet(doc.sheets[spec.sheet])
    const boss = league[key]
    const starters = [...new Set(boss.pokemon.map((p) => p.starter).filter(Boolean))]
    const result = { variants: {} }
    for (const starter of starters.length ? starters : [null]) {
      const team = docTeam(parsed[spec.sheet], spec, starter)
      const app = boss.pokemon.filter((p) => !p.starter || p.starter === starter)
      result.variants[starter || 'all'] = team.length
        ? { diffs: compare(app, team, { nameOf, levelScaled: LEVEL_SCALED.includes(key) }), docSize: team.length }
        : { missing: true }
    }
    out[key] = result
  }
  return out
}

// ---- Applying supported corrections

/**
 * league.json with only its top-level "unbound" value rewritten, so the rest
 * of the file keeps its exact formatting. Throws if the current "unbound"
 * text isn't the standard 2-space form (then a rewrite would not be minimal).
 */
export function replaceUnbound(raw, current, next) {
  const indent = (v) => JSON.stringify(v, null, 2).replace(/\n/g, '\n  ')
  const before = `"unbound": ${indent(current)}`
  const at = raw.indexOf(before)
  if (at < 0 || raw.indexOf(before, at + 1) >= 0) throw new Error('league.json "unbound" section is not in the expected format')
  return raw.slice(0, at) + `"unbound": ${indent(next)}` + raw.slice(at + before.length)
}

/**
 * Applies the differences the workbook supports to a copy of league.unbound.
 * A value is applied only when it resolves to a known move/ability/item id;
 * anything else (misspellings, unknown names, species changes, level-scaled
 * rival levels) is returned as unsupported.
 */
export function plan(result, league, { moves, abilities, items }) {
  const next = structuredClone(league)
  const applied = []
  const unsupported = []
  for (const [key, { variants }] of Object.entries(result)) {
    for (const [variant, v] of Object.entries(variants)) {
      if (v.missing) {
        unsupported.push({ key, variant, reason: 'battle not found in the workbook' })
        continue
      }
      for (const d of v.diffs) {
        const mon = next[key].pokemon.find((p) => p.name === d.mon && (variant === 'all' || !p.starter || p.starter === variant))
        const where = { key, variant, mon: d.mon, field: d.field, app: d.app, doc: d.doc }
        if (!mon || d.field === 'species' || d.field === 'level') {
          unsupported.push({ ...where, reason: d.field === 'species' ? 'species change: review by hand' : 'not imported' })
          continue
        }
        if (d.field === 'moves') {
          const ids = d.doc.map(slug)
          const bad = ids.filter((id) => !moves.has(norm(id)))
          if (bad.length) unsupported.push({ ...where, reason: `unknown move ${bad.join(', ')}` })
          else {
            mon.moves = ids
            applied.push(where)
          }
        } else if (d.field === 'ability') {
          const id = slug(String(d.doc).split('→')[0].split('/')[0])
          if (!abilities.has(norm(id))) unsupported.push({ ...where, reason: `unknown ability ${id}` })
          else {
            mon.ability = id
            mon.abilities = [id]
            applied.push(where)
          }
        } else if (d.field === 'held') {
          const id = d.doc ? slug(d.doc) : null
          if (id && !items.has(norm(id))) unsupported.push({ ...where, reason: `unknown item ${id}` })
          else {
            if (id) mon.held = id
            else delete mon.held
            applied.push(where)
          }
        }
      }
    }
  }
  return { next, applied, unsupported }
}

// ---- Prebuilt boss files (static/api/league/unbound.<starter>.json)

export const STATIC_DIR = path.join(ROOT, 'static/api/league')
const STARTERS = ['fire', 'grass', 'water']

/**
 * Applies the same corrections to the prebuilt per-starter boss files the
 * cards read. Move/ability/item objects are reused from those files (they
 * carry type, power and effect text); throws - writing nothing - if one is
 * missing, so the files never hold a half-applied change.
 * @returns { [file]: newJson }
 */
export function syncStatic(applied, next, files) {
  const lookup = { moves: new Map(), ability: new Map(), held: new Map() }
  for (const json of Object.values(files))
    for (const boss of Object.values(json))
      for (const p of boss.pokemon || []) {
        for (const m of p.moves || []) lookup.moves.set(norm(m.name), m)
        if (p.ability?.name) lookup.ability.set(norm(p.ability.name), p.ability)
        if (p.held?.name) lookup.held.set(norm(p.held.name), p.held)
      }
  const find = (map, id) => {
    const hit = map.get(norm(id))
    if (!hit) throw new Error(`no prebuilt data for "${id}" - regenerate the static boss files instead`)
    return hit
  }
  const out = structuredClone(files)
  for (const a of applied) {
    for (const starter of a.variant === 'all' ? STARTERS : [a.variant]) {
      const file = `unbound.${starter}.json`
      const team = next[a.key].pokemon.filter((p) => !p.starter || p.starter === starter)
      const index = team.findIndex((p) => p.name === a.mon)
      const target = out[file]?.[a.key]?.pokemon?.[index]
      if (!target) throw new Error(`${file} ${a.key}: no Pokémon #${index}`)
      const mon = team[index]
      if (a.field === 'moves') target.moves = mon.moves.map((id) => find(lookup.moves, id))
      if (a.field === 'ability') target.ability = find(lookup.ability, mon.ability)
      if (a.field === 'held') {
        if (mon.held) target.held = find(lookup.held, mon.held)
        else delete target.held
      }
    }
  }
  return out
}

/** Per boss key: does the app team match the workbook (after corrections)? */
export function checks(result) {
  const out = {}
  for (const [key, { variants }] of Object.entries(result)) {
    const missing = Object.values(variants).some((v) => v.missing)
    const diffs = Object.entries(variants).flatMap(([variant, v]) =>
      (v.diffs || []).map((d) => {
        const label = variant === 'all' ? '' : `[${variant}] `
        const show = (x) => (Array.isArray(x) ? x.join('/') : x ?? 'none')
        return `${label}${d.mon}: ${d.field} ${show(d.app)} (doc ${show(d.doc)})`
      })
    )
    out[key] = {
      status: missing ? 'unsupported' : diffs.length ? 'differs' : 'verified',
      ...(LEVEL_SCALED.includes(key) ? { levelScaled: true } : {}),
      ...(diffs.length ? { diffs } : {})
    }
  }
  return out
}

export const renderChecks = (source, bosses) => `// Generated by tools/import-unbound-bosses.mjs - do not edit by hand.
// How each app Normal boss team (league.json) compares with the
// "${source.title}" workbook. Rival levels are not compared (Level Scaling).
// status: verified | differs (diffs lists each difference) | unsupported
export default ${JSON.stringify({ source, bosses }, null, 2)};
`

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  const file = args[args.indexOf('--difficult') + 1]
  if (!args.includes('--difficult') || !file) throw new Error('Usage: node tools/import-unbound-bosses.mjs --difficult <difficult.json> [--apply]')
  const doc = JSON.parse(fs.readFileSync(file, 'utf8'))
  const league = JSON.parse(fs.readFileSync(LEAGUE, 'utf8')).unbound
  const appPokemon = JSON.parse(fs.readFileSync(APP_POKEMON, 'utf8'))
  const result = compareAll(doc, league, appPokemon)
  const ids = (file) => new Set(Object.keys(JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8'))))
  const patches = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/lib/data/patches.json'), 'utf8')).unbound
  // Ids compared hyphen-free, as the asset data stores them ("metalbash")
  const known = {
    moves: new Set([...ids('src/routes/assets/data/moves.json'), ...Object.keys(patches.move)].map(norm)),
    abilities: new Set([...ids('src/routes/assets/data/abilities.json'), ...Object.keys(patches.ability)].map(norm)),
    items: new Set([...ids('src/routes/assets/data/items.json')].map(norm))
  }
  const { next, applied, unsupported } = plan(result, league, known)
  console.log(JSON.stringify({ applied, unsupported }, null, 1))
  const sha = args.includes('--sha256') ? args[args.indexOf('--sha256') + 1] : null
  const retrieved = args.includes('--retrieved') ? args[args.indexOf('--retrieved') + 1] : null
  if (args.includes('--apply') && applied.length) {
    // Everything is computed before anything is written
    const files = Object.fromEntries(
      [...STARTERS.map((st) => `unbound.${st}.json`), ...STARTERS.map((st) => `unbound_exp.${st}.json`)].map((f) => [
        f,
        JSON.parse(fs.readFileSync(path.join(STATIC_DIR, f), 'utf8'))
      ])
    )
    const staticOut = syncStatic(applied, next, files)
    const raw = fs.readFileSync(LEAGUE, 'utf8')
    const leagueOut = replaceUnbound(raw, league, next)
    fs.writeFileSync(LEAGUE, leagueOut)
    for (const [f, json] of Object.entries(staticOut))
      if (JSON.stringify(json) !== JSON.stringify(files[f])) fs.writeFileSync(path.join(STATIC_DIR, f), JSON.stringify(json, null, 2))
    console.log(`Applied ${applied.length} correction(s) to ${path.relative(ROOT, LEAGUE)}`)
  }
  // Check file reflects league.json as it is now (after any --apply)
  const finalLeague = JSON.parse(fs.readFileSync(LEAGUE, 'utf8')).unbound
  const source = { ...DIFFICULT_DOC, ...(sha ? { sha256: sha } : {}), ...(retrieved ? { retrieved } : {}) }
  fs.writeFileSync(CHECK_OUT, renderChecks(source, checks(compareAll(doc, finalLeague, appPokemon))))
  console.log(`Wrote ${path.relative(ROOT, CHECK_OUT)}`)
}
