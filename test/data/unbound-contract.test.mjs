// Data contracts for the static Unbound game data. These check structure and
// cross-references, not game accuracy (see src/lib/data/unbound/provenance.json
// for what has been verified against sources).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const read = (p) => JSON.parse(fs.readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8'))

const ROUTES = read('src/lib/data/routes.json')
const LEAGUE = read('src/lib/data/league.json').unbound
const PATCHES = read('src/lib/data/patches.json').unbound
const POKEMON = read('src/routes/api/pokemon.json/_pokemon.json')
const MOVES = read('src/routes/assets/data/moves.json')
const ABILITIES = read('src/routes/assets/data/abilities.json')
const PROVENANCE = read('src/lib/data/unbound/provenance.json')
const FROZEN = read('test/data/unbound-route-keys.json')

const GAMES = ['unbound', 'unbound_exp']
const STARTERS = ['fire', 'grass', 'water']
const BOSS_GROUPS = new Set(['gym-leader', 'rival', 'elite-four', 'evil-team', 'mini-boss'])

const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '')
const SPECIES = new Set(POKEMON.flatMap((p) => [norm(p.alias), norm(p.name)]))
const MOVE_IDS = new Set([...Object.keys(MOVES), ...Object.keys(PATCHES.move)].map(norm))
const ABILITY_IDS = new Set([...Object.keys(ABILITIES), ...Object.keys(PATCHES.ability)].map(norm))

const routesOf = (game) => ROUTES[game].filter((r) => r.type === 'route')
const bossesOf = (game) => ROUTES[game].filter((r) => r.type === 'gym')
const league = (game, starter) => read(`static/api/league/${game}.${starter}.json`)

for (const game of GAMES) {
  test(`${game}: every entry is a well-formed route or boss`, () => {
    for (const r of ROUTES[game]) {
      assert.ok(['route', 'gym'].includes(r.type), `${r.name}: type ${r.type}`)
      assert.equal(typeof r.name, 'string')
      assert.ok(r.name.trim(), 'empty name')
      if (r.type === 'route') {
        assert.ok(Array.isArray(r.encounters) && r.encounters.length, `${r.name}: no encounters`)
      } else {
        assert.equal(typeof r.value, 'string', `${r.name}: boss value`)
        assert.ok(BOSS_GROUPS.has(r.group), `${r.value}: unknown group ${r.group}`)
        assert.ok(r.boss, `${r.value}: no boss name`)
      }
    }
  })

  test(`${game}: route names and boss ids are unique`, () => {
    const dupes = (xs) => xs.filter((x, i) => xs.indexOf(x) !== i)
    assert.deepEqual(dupes(routesOf(game).map((r) => r.name)), [])
    assert.deepEqual(dupes(bossesOf(game).map((r) => r.value)), [])
  })

  // Tracker records are keyed by these strings; losing one orphans player data
  test(`${game}: frozen record keys are all still present`, () => {
    const routes = new Set(routesOf(game).map((r) => r.name))
    const bosses = new Set(bossesOf(game).map((r) => r.value))
    const lostRoutes = FROZEN.routes[game].filter((k) => !routes.has(k))
    const lostBosses = FROZEN.bosses[game].filter((k) => !bosses.has(k))
    assert.deepEqual(lostRoutes, [], 'route keys removed/renamed without an alias + migration')
    assert.deepEqual(lostBosses, [], 'boss keys removed/renamed without an alias + migration')
  })

  test(`${game}: every encounter species resolves`, () => {
    const missing = routesOf(game).flatMap((r) =>
      r.encounters.filter((e) => !SPECIES.has(norm(e))).map((e) => `${r.name}: ${e}`)
    )
    assert.deepEqual(missing, [])
  })

  test(`${game}: every boss has a league entry`, () => {
    assert.deepEqual(
      bossesOf(game).map((r) => r.value).filter((v) => !LEAGUE[v]),
      []
    )
  })

  test(`${game}: generated starter files match league.json`, () => {
    const keys = bossesOf(game).map((r) => r.value).sort()
    for (const starter of STARTERS) {
      const built = league(game, starter)
      assert.deepEqual(Object.keys(built).sort(), keys, `${game}.${starter}.json keys`)
      for (const [key, boss] of Object.entries(built)) {
        const want = LEAGUE[key].pokemon.filter((p) => !p.starter || p.starter === starter)
        const got = boss.pokemon
        const fmt = (xs) => xs.map((p) => `${p.name}@${p.level}`).join(', ')
        // the generator drops form suffixes (golem-alola -> golem)
        const same =
          want.length === got.length &&
          want.every(
            (p, i) =>
              (p.name === got[i].name || p.name.startsWith(`${got[i].name}-`)) &&
              String(p.level) === String(got[i].level)
          )
        assert.ok(same, `${game}.${starter} ${key}: ${fmt(want)} vs ${fmt(got)}`)
      }
    }
  })
}

test('starter-dependent bosses have a variant for every starter', () => {
  for (const [key, boss] of Object.entries(LEAGUE)) {
    const variants = new Set(boss.pokemon.map((p) => p.starter).filter(Boolean))
    if (variants.size) assert.deepEqual([...variants].sort(), [...STARTERS].sort(), key)
  }
})

test('boss species, moves and abilities resolve', () => {
  const missing = []
  for (const [key, boss] of Object.entries(LEAGUE)) {
    assert.ok(Array.isArray(boss.pokemon) && boss.pokemon.length, `${key}: empty team`)
    for (const p of boss.pokemon) {
      if (!SPECIES.has(norm(p.name))) missing.push(`${key} species ${p.name}`)
      assert.ok(Number(p.level) >= 1 && Number(p.level) <= 100, `${key} ${p.name}: level ${p.level}`)
      for (const m of p.moves || []) if (!MOVE_IDS.has(norm(m))) missing.push(`${key} move ${m}`)
      if (p.ability && !ABILITY_IDS.has(norm(p.ability))) missing.push(`${key} ability ${p.ability}`)
    }
  }
  assert.deepEqual(missing, [])
})

test('every Unbound dataset file has a provenance entry', () => {
  const required = ['source', 'method', 'status', 'gameVersion']
  for (const [name, d] of Object.entries(PROVENANCE.datasets)) {
    assert.ok(Array.isArray(d.files) && d.files.length, `${name}: files`)
    for (const f of required) assert.ok(d[f] || (f === 'source' && d.sources?.length), `${name}: ${f}`)
    for (const s of d.sources || []) assert.ok(s.url && s.retrieved && s.license, `${name}: source fields`)
  }
  const covered = Object.values(PROVENANCE.datasets).flatMap((d) => d.files).join('\n')
  for (const f of ['routes.json#unbound', 'league.json#unbound', 'patches.json#unbound', 'level-caps.data.js'])
    assert.ok(covered.includes(f), `no provenance for ${f}`)
  // Anything added to src/lib/data/unbound must be described
  for (const f of fs.readdirSync(new URL('../../src/lib/data/unbound/', import.meta.url)))
    if (f !== 'provenance.json') assert.ok(covered.includes(f), `no provenance for src/lib/data/unbound/${f}`)
})

// ---- Documented encounter tables (src/lib/data/unbound/encounters.data.js)

const { default: ENCOUNTERS } = await import('../../src/lib/data/unbound/encounters.data.js')
const { default: LOCATIONS } = await import('../../src/lib/data/unbound/locations.data.js')
const { speciesOrder } = await import('../../src/lib/unbound/encounter-groups.js')
const { enrichedList } = await import('../../tools/build-unbound-encounters.mjs')

const METHODS = new Set(['grass', 'cave', 'sand', 'walk', 'surf', 'dive', 'old-rod', 'good-rod', 'super-rod', 'rock-smash', 'tree', 'safari', 'gift', 'static', 'special', 'trade', 'egg'])
const KINDS = new Set(['wild', 'special', 'static', 'gift', 'trade', 'egg'])
const ALIASES = new Set(POKEMON.map((p) => p.alias))
const mainStory = (game) => {
  const routes = ROUTES[game]
  const champion = routes.findIndex((r) => r.type === 'gym' && r.value.replace(/_exp$/, '') === 'c')
  return routes.slice(0, champion).filter((r) => r.type === 'route' && r.name !== 'Starter').map((r) => r.name)
}

test('encounter tables cover every main-story route key and nothing else', () => {
  for (const game of GAMES) assert.deepEqual(Object.keys(ENCOUNTERS.locations).sort(), mainStory(game).sort(), game)
})

test('encounter rows are well-formed and use tracker species aliases', () => {
  const bad = []
  for (const [key, loc] of Object.entries(ENCOUNTERS.locations)) {
    assert.ok(Number.isInteger(loc.revid) && loc.page, `${key}: revision`)
    assert.ok(loc.rows.length, `${key}: no rows`)
    for (const e of loc.rows) {
      const at = `${key}${e.area ? ` [${e.area}]` : ''} ${e.species}`
      if (!ALIASES.has(e.species)) bad.push(`${at}: unknown species`)
      if (e.kind === 'swarm') {
        if (e.method !== 'swarm' || e.levels || e.rate) bad.push(`${at}: swarm rows carry no method details`)
        continue
      }
      if (!METHODS.has(e.method)) bad.push(`${at}: method ${e.method}`)
      if (!KINDS.has(e.kind)) bad.push(`${at}: kind ${e.kind}`)
      if (e.levels && !(e.levels[0] >= 1 && e.levels[0] <= e.levels[1] && e.levels[1] <= 100)) bad.push(`${at}: levels ${e.levels}`)
      for (const r of Object.values(e.rate || {})) if (r != null && !(r >= 0 && r <= 100)) bad.push(`${at}: rate ${r}`)
      if (e.kind === 'wild' && !e.rate) bad.push(`${at}: wild row without rate`)
    }
    for (const s of loc.postGame || []) if (!ALIASES.has(s)) bad.push(`${key}: unknown species ${s}`)
  }
  assert.deepEqual(bad, [])
})

// The picker's list (routes.json) and the details must describe the same species
for (const game of GAMES) {
  test(`${game}: documented routes list exactly the documented species first, then only older fallbacks`, () => {
    for (const r of routesOf(game)) {
      const loc = ENCOUNTERS.locations[r.name]
      if (!loc) continue
      const documented = speciesOrder(loc.rows)
      assert.deepEqual(r.encounters.slice(0, documented.length), documented, `${r.name}: documented species, in picker order`)
      const fallback = r.encounters.slice(documented.length)
      assert.equal(new Set(r.encounters).size, r.encounters.length, `${r.name}: duplicates`)
      for (const s of fallback) {
        assert.ok(!(loc.postGame || []).includes(s), `${r.name}: ${s} is post-game only`)
        assert.ok(!documented.some((d) => d === s || d.startsWith(`${s}-`)), `${r.name}: ${s} is documented`)
      }
      assert.deepEqual(enrichedList(r.encounters, loc), r.encounters, `${r.name}: routes.json is up to date with the generator`)
    }
  })
}

test('encounter data carries its license and source', () => {
  assert.equal(ENCOUNTERS.license, 'CC BY-SA 4.0')
  assert.match(ENCOUNTERS.source, /^https:\/\/pokemonunbound\.miraheze\.org$/)
})

test('met-location ids map to existing route keys', () => {
  const keys = new Set(ROUTES.unbound.filter((r) => r.type === 'route').map((r) => r.name))
  for (const [id, loc] of Object.entries(LOCATIONS)) {
    assert.ok(Number.isInteger(+id) && +id >= 0 && +id <= 255, `id ${id}`)
    assert.ok(keys.has(loc.key), `${id}: ${loc.key} is not a route key`)
    assert.ok(loc.evidence, `${id}: no evidence`)
    assert.equal(typeof loc.confirmed, 'boolean')
  }
})

// ---- Boss wiki checks (src/lib/data/unbound/bosses.verification.data.js)

const { default: BOSS_CHECKS } = await import('../../src/lib/data/unbound/bosses.verification.data.js')
const STATUSES = new Set(['verified', 'differs', 'unsupported', 'post-game'])

test('every Unbound boss in both difficulties has a wiki check', () => {
  for (const game of GAMES) {
    for (const r of bossesOf(game)) {
      const c = BOSS_CHECKS.bosses[r.value]
      assert.ok(c, `${r.value}: no check`)
      assert.ok(STATUSES.has(c.status), `${r.value}: status ${c.status}`)
      if (c.status === 'differs') assert.ok(c.diffs?.length, `${r.value}: differs without details`)
      if (c.status !== 'post-game') assert.ok(Number.isInteger(c.revid) && c.page, `${r.value}: source revision`)
    }
  }
  assert.equal(BOSS_CHECKS.license, 'CC BY-SA 4.0')
})

// ---- Trainer doc checks and prebuilt boss files

const { default: DOC_CHECKS } = await import('../../src/lib/data/unbound/bosses.trainer-doc.data.js')

test('every main-story Normal boss has a trainer-doc check', () => {
  const champion = ROUTES.unbound.findIndex((r) => r.type === 'gym' && r.value === 'c')
  for (const r of ROUTES.unbound.slice(0, champion + 1).filter((r) => r.type === 'gym')) {
    const c = DOC_CHECKS.bosses[r.value]
    assert.ok(c && ['verified', 'differs', 'unsupported'].includes(c.status), `${r.value}: no doc check`)
  }
  assert.equal(DOC_CHECKS.source.gameVersion, '2.1.1.1')
  assert.match(DOC_CHECKS.source.sha256, /^[0-9a-f]{64}$/)
})

for (const game of GAMES) {
  test(`${game}: prebuilt boss files have the same moves as league.json`, () => {
    const bad = []
    for (const starter of STARTERS) {
      for (const [key, boss] of Object.entries(league(game, starter))) {
        const want = LEAGUE[key].pokemon.filter((p) => !p.starter || p.starter === starter)
        boss.pokemon.forEach((p, i) => {
          // prebuilt files name every hidden-power-<type> "Hidden Power"
          const move = (x) => norm(x).replace(/^hiddenpower.*/, 'hiddenpower')
          const a = (want[i].moves || []).map(move).join()
          const b = (p.moves || []).map((m) => move(m.name)).join()
          if (a !== b) bad.push(`${game}.${starter} ${key} ${want[i].name}: ${a} vs ${b}`)
        })
      }
    }
    assert.deepEqual(bad, [])
  })
}
