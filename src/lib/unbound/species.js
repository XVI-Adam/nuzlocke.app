// Display info for Unbound species ids (see forms.js for naming rules)
import SPECIES from './species.data.js'

export const FALLBACK_ICON = 'unknown-pokemon2'

/** @returns {{ name: string|null, form: string|null, formKey: string|null, label: string, icon: string|null }} */
export const describeSpecies = (id) =>
  SPECIES[id] || { name: null, form: null, formKey: null, label: `Unknown species #${id}`, icon: null }

/** Icon name for PIcon, falling back to the "?" icon */
export const iconFor = (id) => describeSpecies(id).icon || FALLBACK_ICON
