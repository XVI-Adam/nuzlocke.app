// Names Unbound species (including alternate forms) and picks their icon.
//
// Source of truth is each species' SPECIES_* constant from the ROM (vendored
// speciesConstants). Species sharing a display name are one Pokémon in
// different forms; the constant suffix after their shared root identifies
// the form (SPECIES_GYARADOS_MEGA -> MEGA).
//
// Only suffixes whose meaning is unambiguous get a human label. Short codes
// mean different things per species (M = Male for Basculegion, the letter M
// for Unown, a size for Pumpkaboo), so unreviewed short codes fall back to a
// visibly raw label, e.g. "Oricorio (form Y)", rather than a guess.
//
// Pure: used by tools/build-unbound-species.mjs to generate species.data.js.

// Names the ROM text table stores with unencodable characters ('?'),
// corrected only when the stored name is actually garbled
const NAME_FIXES = [
  [/^NIDORAN_F$/, 'Nidoran♀'],
  [/^NIDORAN_M$/, 'Nidoran♂'],
  [/^MR_MIME(_|$)/, 'Mr. Mime'],
  [/^MR_RIME$/, 'Mr. Rime'],
  [/^MIME_JR(_|$)/, 'Mime Jr.'],
  [/^FLABEBE(_|$)/, 'Flabébé'],
  [/^UNOWN_/, 'Unown']
]

// The ROM name table holds 10 characters, so longer names are abbreviated
// (Crabminble). Restored from the constant, only for that exact abbreviation.
const TRUNCATED = {
  Fletchindr: ['FLETCHINDER', 'Fletchinder'],
  Crabminble: ['CRABOMINABLE', 'Crabominable'],
  Blacphalon: ['BLACEPHALON', 'Blacephalon'],
  Corvsquire: ['CORVISQUIRE', 'Corvisquire'],
  Corvknight: ['CORVIKNIGHT', 'Corviknight'],
  Baraskewda: ['BARRASKEWDA', 'Barraskewda'],
  Centskorch: ['CENTISKORCH', 'Centiskorch'],
  Poltegeist: ['POLTEAGEIST', 'Polteageist'],
  Stonjorner: ['STONJOURNER', 'Stonjourner'],
  Basculegon: ['BASCULEGION', 'Basculegion']
}

// Constants that don't separate their form with "_"
const CONSTANT_FIXES = { DARMANITANZEN: 'DARMANITAN_ZEN', ASHGRENINJA: 'GRENINJA_ASH' }

const REGIONAL = { A: ['Alolan', 'alola'], G: ['Galarian', 'galar'], H: ['Hisuian', 'hisui'] }

// Unambiguous suffixes, valid for any species
const SUFFIXES = {
  MEGA: { form: 'Mega', label: (n) => `Mega ${n}`, icon: 'mega' },
  MEGA_X: { form: 'Mega X', label: (n) => `Mega ${n} X`, icon: 'mega-x' },
  MEGA_Y: { form: 'Mega Y', label: (n) => `Mega ${n} Y`, icon: 'mega-y' },
  PRIMAL: { form: 'Primal', label: (n) => `Primal ${n}`, icon: 'primal' },
  GIGA: { form: 'Gigantamax', label: (n) => `Gigantamax ${n}`, icon: 'gmax' },
  ZEN: { form: 'Zen Mode', label: (n) => `${n} (Zen Mode)`, icon: 'zen' },
  G_ZEN: { form: 'Galarian Zen Mode', label: (n) => `Galarian ${n} (Zen Mode)`, icon: 'galar-zen' },
  ASH: { form: 'Ash', label: (n) => `Ash-${n}`, icon: 'ash' },
  ...Object.fromEntries(
    Object.entries(REGIONAL).map(([k, [adj, icon]]) => [k, { form: adj, label: (n) => `${adj} ${n}`, icon }])
  )
}

// Reviewed codes, keyed by the full constant
const FEMALE = { form: 'Female', label: (n) => `${n} (Female)`, icon: 'f' }
const SPECIFIC = {
  UNFEZANT_F: FEMALE,
  FRILLISH_F: FEMALE,
  JELLICENT_F: FEMALE,
  HIPPOPOTAS_F: FEMALE,
  HIPPOWDON_F: FEMALE,
  BASCULEGION_F: FEMALE,
  BASCULEGION_M: { form: 'Male', label: (n) => `${n} (Male)`, icon: 'male' },
  ZYGARDE_10: { form: '10% Forme', label: (n) => `${n} (10% Forme)`, icon: '10' },
  FURFROU_LA_REINE: { form: 'La Reine', label: (n) => `${n} (La Reine)`, icon: 'la-reine' }
}

// Icons for base forms the icon sheet names by their (default) form
const BASE_ICONS = { WISHIWASHI: 'wishiwashi-solo', ENAMORUS: 'enamorus-incarnate' }

// Tracker aliases for base forms the app's data names by their default form
const BASE_ALIASES = {
  SHAYMIN: 'shaymin-land',
  LANDORUS: 'landorus-incarnate',
  ENAMORUS: 'enamorus-incarnate',
  KELDEO: 'keldeo-ordinary',
  MELOETTA: 'meloetta-aria',
  MEOWSTIC: 'meowstic-male',
  AEGISLASH: 'aegislash-shield',
  LYCANROC: 'lycanroc-midday',
  MORPEKO: 'morpeko-full-belly'
}

const titleCase = (tokens) => tokens.map((t) => t[0] + t.slice(1).toLowerCase()).join(' ')
const slug = (tokens) => tokens.join('-').toLowerCase()
const tokensOf = (constant) => {
  const bare = constant.replace(/^SPECIES_/, '')
  return (CONSTANT_FIXES[bare] || bare).split('_')
}

const isPlaceholder = (name) => !name || /^\?+$/.test(name) || name === 'NONE' || name.startsWith('MISSINGNO')

const commonPrefix = (lists) => {
  const out = []
  for (let i = 0; lists.every((l) => i < l.length && l[i] === lists[0][i]); i++) out.push(lists[0][i])
  return out
}

// Label for one suffix; `null` form means the base form
const describeSuffix = (name, suffix, bareConstant) => {
  if (!suffix.length) return { form: null, formKey: null, label: name, icon: null }
  const key = suffix.join('_')
  const rule = SPECIFIC[bareConstant] || SUFFIXES[key]
  if (rule) return { form: rule.form, formKey: key, label: rule.label(name), icon: rule.icon }

  // Unown letters: the suffix *is* the letter (or EXCLAMATION / QUESTION)
  if (bareConstant.startsWith('UNOWN_')) {
    const letter = key === 'EXCLAMATION' ? '!' : key === 'QUESTION' ? '?' : key
    return { form: letter, formKey: key, label: `${name} (${letter})`, icon: slug(suffix) }
  }

  // Whole-word suffixes (HEAT, ORIGIN, ICE_RIDER...) read as written
  if (suffix.every((t) => t.length >= 3 && /^[A-Z]+$/.test(t))) {
    const form = titleCase(suffix)
    return { form, formKey: key, label: `${name} (${form})`, icon: slug(suffix) }
  }

  // Unreviewed short code: say so instead of guessing
  return { form: `form ${key}`, formKey: key, label: `${name} (form ${key})`, icon: null, formKnown: false }
}

const comparable = (s) =>
  String(s || '')
    .normalize('NFD')
    .replace(/[^A-Za-z0-9]/g, '')
    .toLowerCase()

/**
 * @param names       { [id]: display name } from the ROM text table
 * @param constants   { [id]: 'SPECIES_*' }
 * @param iconNames   Set of available icon names (pkm-<name> CSS classes)
 * @param appPokemon  the tracker's Pokémon data ([{ alias, name }]); an alias
 *                    is only assigned when it exists there under the same name
 * @returns { [id]: { name, form, formKey, label, icon, alias } }
 */
export function buildSpeciesTable({ names, constants, iconNames, appPokemon = [] }) {
  const appNames = new Map(appPokemon.map((p) => [p.alias, comparable(p.name)]))
  const ids = new Set([...Object.keys(constants), ...Object.keys(names)].map(Number))
  const entries = [...ids]
    .sort((a, b) => a - b)
    .map((id) => {
      // A few ids (Egg, unused slots) have a name but no constant
      const constant = constants[id] || `SPECIES_${String(names[id] ?? '').toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`
      const tokens = tokensOf(constant)
      let name = String(names[id] ?? '').trim()
      if (name.includes('?')) {
        const fix = NAME_FIXES.find(([re]) => re.test(tokens.join('_')))
        if (fix) name = fix[1]
      }
      const full = TRUNCATED[name]
      if (full && tokens[0] === full[0]) name = full[1]
      return { id, constant, tokens, name }
    })

  const table = {}
  const groups = new Map()
  for (const e of entries) {
    if (isPlaceholder(e.name)) {
      table[e.id] = { name: null, form: null, formKey: null, label: `Unknown species #${e.id}`, icon: null, alias: null }
      continue
    }
    if (!groups.has(e.name)) groups.set(e.name, [])
    groups.get(e.name).push(e)
  }

  for (const [name, group] of groups) {
    const root = group.length > 1 ? commonPrefix(group.map((e) => e.tokens)) : group[0].tokens
    for (const e of group) {
      // No shared root (e.g. differently-named constants): treat each as its own base
      const suffix = root.length ? e.tokens.slice(root.length) : []
      const d = describeSuffix(name, suffix, e.tokens.join('_'))

      const base = slug(root.length ? root : e.tokens)
      const nameSlug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
      const candidates =
        suffix.length === 0
          ? [base, nameSlug, BASE_ICONS[e.tokens.join('_')]]
          : d.icon
          ? [`${base}-${d.icon}`]
          : []
      const icon = candidates.find((c) => iconNames.has(c)) || null
      // Tracker alias (e.g. 'sandshrew-alola'): verified to exist with this name
      const aliasCandidates = suffix.length === 0 ? [...candidates, BASE_ALIASES[e.tokens.join('_')]] : candidates
      const alias = aliasCandidates.find((c) => c && appNames.get(c) === comparable(name)) || null

      table[e.id] = {
        name,
        form: d.form,
        formKey: d.formKey,
        label: d.label,
        icon,
        alias,
        ...(d.formKnown === false ? { formKnown: false } : {})
      }
    }
  }
  return table
}

/** Extracts icon names from the pokemon icon stylesheet */
export const iconNamesFromCss = (css) => new Set([...css.matchAll(/\.pkm-([a-z0-9-]+)/g)].map((m) => m[1]))
