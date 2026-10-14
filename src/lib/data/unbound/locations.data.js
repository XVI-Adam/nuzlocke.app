// Save met-location ids (mon met location byte) -> existing route keys.
// Static game data - see provenance.json.
//
// No documented id table exists for Unbound, and ids are not simply
// FireRed's (99 is Route 4, while 101-106 are Routes 1-3, 5, 6), so nothing
// here is inferred from numbering. Each entry is backed by in-game evidence:
// a mon in a real save whose species line and met level match exactly one
// location in the documented encounter tables (encounters.data.js). They
// are unconfirmed until checked against the in-game summary screen
// ("Met in ..."); set `confirmed: true` only then. Ids not listed show as
// "Unknown location #<id>".
//
// { [locationId]: { key: route key in routes.json, evidence, confirmed } }
export default {
  89: { key: 'Bellin Town', evidence: 'Stunky Lv 10 (gift, Lv 10)', confirmed: false },
  91: { key: 'Crater Town', evidence: 'Clefairy Lv 20 (special encounter, Lv 20)', confirmed: false },
  99: { key: 'Route 4', evidence: 'Noctowl Lv 16 (grass, Hoothoot line Lv 14-17)', confirmed: false },
  101: { key: 'Route 1', evidence: 'Snorunt Lv 9 (grass, Lv 7-9)', confirmed: false },
  102: { key: 'Route 2', evidence: 'Litleo Lv 14 (Challenge Road gift)', confirmed: false },
  103: { key: 'Route 3', evidence: 'Masquerain Lv 11 (grass, Surskit line Lv 9-12)', confirmed: false },
  105: { key: 'Route 5', evidence: 'Dewott Lv 15 (gift, Lv 15)', confirmed: false },
  106: { key: 'Route 6', evidence: 'Bunnelby Lv 22 (grass, Lv 20-22)', confirmed: false },
  126: { key: 'Grim Woods', evidence: 'Gastly line Lv 16 (grass, Lv 13-16)', confirmed: false },
  127: { key: 'Cinder Volcano', evidence: 'Slugma line Lv 17 (cave 1F-4F, Lv 15-17)', confirmed: false },
  131: { key: 'Valley Cave', evidence: 'Phanpy Lv 21 (cave, Lv 18-21)', confirmed: false },
  133: { key: 'Starter', evidence: 'Starter Pokémon (Larvitar Lv 10)', confirmed: false },
  134: { key: 'KBT Expressway', evidence: 'Zubat Lv 19 (cave, west entrances, Lv 18-21)', confirmed: false },
  136: { key: 'Flower Paradise', evidence: 'Ribombee Lv 11 (grass, Cutiefly line Lv 9-12)', confirmed: false },
  141: { key: 'Icicle Cave', evidence: 'Alolan Sandshrew Lv 8 (4F outside, Lv 8-10)', confirmed: false }
}
