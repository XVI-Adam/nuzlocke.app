// How documented Unbound encounters are grouped, ordered and described.
// Pure, data-free module shared by the generator (tools/), the route API
// and the encounter picker.

// Picker groups, in display order. Wild encounters group by method; one-off
// encounters (gifts, trades, eggs, statics, specials) and swarms by kind.
export const GROUPS = [
  ['grass', 'Grass'],
  ['cave', 'Cave'],
  ['sand', 'Sand'],
  ['walk', 'Walking'],
  ['tree', 'Tree'],
  ['rock-smash', 'Rock Smash'],
  ['surf', 'Surf'],
  ['dive', 'Dive'],
  ['old-rod', 'Old Rod'],
  ['good-rod', 'Good Rod'],
  ['super-rod', 'Super Rod'],
  ['safari', 'Safari Zone'],
  ['swarm', 'Swarm'],
  ['gift', 'Gift'],
  ['trade', 'Trade'],
  ['egg', 'Egg'],
  ['static', 'Static'],
  ['special', 'Special']
]
const RANK = Object.fromEntries(GROUPS.map(([k], i) => [k, i]))
export const GROUP_LABEL = Object.fromEntries(GROUPS)

/** Group key of one documented row */
export const groupOf = (row) => (row.kind === 'wild' ? row.method : row.kind)

const rank = (row) => RANK[groupOf(row)] ?? GROUPS.length

/** Rows sorted by group (stable within a group, so source order is kept) */
export const sortRows = (rows) =>
  rows
    .map((row, i) => [row, i])
    .sort(([a, i], [b, j]) => rank(a) - rank(b) || i - j)
    .map(([row]) => row)

/** Species in picker order: by the first group each appears in */
export const speciesOrder = (rows) => [...new Set(sortRows(rows).map((r) => r.species))]

/** { [species]: rows sorted by group } */
export const rowsBySpecies = (rows) => {
  const out = {}
  for (const row of sortRows(rows)) (out[row.species] = out[row.species] || []).push(row)
  return out
}

// ---- Text (never invents values: unknown levels/rates are left out)

export const levelText = (levels) =>
  !levels ? '' : levels[0] === levels[1] ? `Lv ${levels[0]}` : `Lv ${levels[0]}–${levels[1]}`

const pct = (n) => `${n}%`
export const rateText = (rate) => {
  if (!rate) return ''
  if ('all' in rate) return rate.all == null ? '' : pct(rate.all)
  const { day, night } = rate
  if (day == null && night == null) return ''
  // One side undocumented ("X%" on the wiki): say so rather than guess
  // (0% by day + unknown at night = night only, rate unknown)
  if (night == null) return day ? `${pct(day)} day · night rate unknown` : 'night, rate unknown'
  if (day == null) return night ? `${pct(night)} night · day rate unknown` : 'day, rate unknown'
  if (day === night) return pct(day)
  if (!day) return `${pct(night)} night`
  if (!night) return `${pct(day)} day`
  return `${pct(day)} day · ${pct(night)} night`
}

/** One compact line for a row: "Lv 8–11 · 20% day · 4F" / "Lv 10 · Beat all trainers" */
export const rowText = (row) =>
  [
    levelText(row.levels),
    rateText(row.rate),
    row.form ? `form ${row.form}` : '',
    row.nickname ? `"${row.nickname}"` : '',
    row.area || '',
    row.note || '',
    row.levelsNote ? `level ${row.levelsNote}` : ''
  ]
    .filter(Boolean)
    .join(' · ')
