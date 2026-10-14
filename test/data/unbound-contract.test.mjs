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
