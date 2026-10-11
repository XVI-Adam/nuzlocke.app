import day from '$lib/utils/date'

/** A stored timestamp as a date, or "Unknown" when it was never recorded */
export const fmtDate = (ms, format = 'D MMM YYYY') => (Number.isFinite(+ms) && +ms > 0 ? day(+ms).format(format) : 'Unknown')

export const fmtKnown = (v, suffix = '') => (v === null || v === undefined ? 'Unknown' : `${v}${suffix}`)
