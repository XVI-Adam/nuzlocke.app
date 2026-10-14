// Pokémon Unbound level caps (Battle Options -> Exp. Gain -> "Capped Exp.
// Share"). Static game data - see provenance.json for sources and status.
//
// Both sources give one table for "Difficult and higher", so the app's Normal
// (unbound) and Expert (unbound_exp) runs share it. Caps are removed once the
// player becomes Champion.
//
// The "after Tarmigan Mansion" cap applies between the 4th and 5th badge.
// No documented save flag marks that milestone, so at 4 badges callers get
// both values rather than a guess.
export default {
  gameVersion: '2.1.1.1',
  difficult: {
    byBadges: [20, 26, 32, 36, 40, 52, 57, 61, 75],
    milestones: [{ afterBadges: 4, id: 'tarmigan-mansion', label: 'Tarmigan Mansion', cap: 45 }],
    champion: null
  }
}
