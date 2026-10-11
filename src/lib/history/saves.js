// The run list (`nuzlocke.saves`): a comma-separated string of
// `id|created[>updated]|name|game|settings|attempts`. Moved here from
// store.js so the pure history modules (and node tests) can use it; entries
// without an id or timestamp (e.g. a stored "null") are now skipped.

export const parseSaves = (gameData) =>
  (gameData || '')
    .split(',')
    .filter((i) => i.length)
    .map((i) => i.split('|'))
    .filter(([id, time]) => id && id !== 'null' && id !== 'undefined' && time)
    .reduce((acc, [id, time, name, game, settings, attempts = 1]) => {
      const [created, updated] = time.split('>')
      return {
        ...acc,
        [id]: {
          id,
          created,
          ...(updated ? { updated } : {}),
          name: decodeURIComponent(name),
          game,
          settings,
          attempts
        }
      }
    }, {})

export const formatSave = (saveData) =>
  [
    saveData.id,
    saveData.updated ? saveData.created + '>' + saveData.updated : saveData.created,
    encodeURIComponent(saveData.name),
    saveData.game,
    saveData.settings,
    +saveData.attempts || 1
  ].join('|')

export const formatSaves = (saves) => Object.values(saves).map(formatSave).join(',')
