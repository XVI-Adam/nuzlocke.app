/* eslint no-undef: 0 */
import { browser } from '$app/environment'
import { writable } from 'svelte/store'

import { NuzlockeGroups } from '$lib/data/states'
import { toObj } from '$lib/utils/obj'
import { uuid } from '$lib/utils/uuid'
import { parseSaves, formatSave } from '$lib/history/saves'

import { settingsDefault } from '$lib/components/Settings/_data'

/** TODO: Team state
    __teams: { [bossKey]: [id,id,id] }
    __team: [id,id,id]
*/

export const popover = writable(null)

export const readdata = (_) => {
  const active = window.localStorage.getItem(IDS.active)
  const saveData = _parse(window.localStorage.getItem(IDS.saves))
  const gameData = _read(window.localStorage.getItem(IDS.game(active))) || []
  const gameKey = saveData[active]?.game

  return [gameData, gameKey, active, saveData[active]]
}

export const IDS = {
  user: 'nuzlocke.user',
  theme: 'nuzlocke.theme',
  active: 'nuzlocke',
  saves: 'nuzlocke.saves',
  consent: 'nuzlocke.consent',
  support: 'nuzlocke.support',
  game: (id) => `nuzlocke.${id}`
}

const createWritable = (
  id,
  f = (val) => browser && val && localStorage.setItem(id, val),
  ssDefault = ''
) => {
  const store = browser ? localStorage.getItem(id) : ssDefault
  const w = writable(store)
  w.subscribe(f)
  return w
}

export const theme = createWritable(IDS.theme)
export const consent = createWritable(IDS.consent)
export const support = createWritable(IDS.support)
export const activeGame = createWritable(IDS.active)
export const savedGames = createWritable(IDS.saves)

export const deleteGame = (id) => {
  if (!window.confirm('This will delete all data, are you sure?')) return

  localStorage.removeItem(IDS.game(id))
  localStorage.removeItem(`${IDS.game(id)}.unbound`) // see $lib/unbound/baseline
  localStorage.removeItem(`${IDS.game(id)}.attempt`) // see $lib/history/attempt
  savedGames.update((g) => {
    if (!id)
      return g
        .split(',')
        .filter((i) => !i.startsWith('|'))
        .join(',')

    return g
      .split(',')
      .filter((i) => !i.startsWith(id) && !i.startsWith('|'))
      .join(',')
  })
}

export const createUser = () => {
  if (!browser) return
  localStorage.setItem(IDS.user, localStorage.getItem(IDS.user) || uuid())
}

let gameStoreCache = {}
export const getGameStore = (id) => {
  if (gameStoreCache[id]) return gameStoreCache[id]
  gameStoreCache[id] = getGame(id)
  return gameStoreCache[id]
}

/**
 * Re-reads the stores above from browser storage after something other than
 * them wrote it (cross-device sync), so a page that is open never writes its
 * older in-memory copy back over the newer data.
 */
export const reloadFromStorage = () => {
  if (!browser) return
  activeGame.set(localStorage.getItem(IDS.active))
  savedGames.set(localStorage.getItem(IDS.saves))
  for (const [id, store] of Object.entries(gameStoreCache)) {
    const raw = localStorage.getItem(IDS.game(id))
    if (raw) store.set(raw)
  }
}

export const createGame =
  (name, game, initData = '{}') =>
  (payload) => {
    if (!browser) return

    const id = uuid()
    const games =
      payload === 'null' || payload === null || payload === 'undefined'
        ? []
        : payload.split(',').filter((i) => i.length)

    const gameData = format({
      id,
      created: +new Date(),
      name,
      game,
      settings: settingsDefault
    })

    localStorage.setItem(IDS.game(id), initData)
    activeGame.set(id)

    console.log(`Creating new game for ${name} ${game}`)
    return games.concat(gameData).join(',')
  }

export const updateGame = (game) => (payload) => {
  if (!browser) return

  const games =
    payload === 'null' || payload === null || payload === 'undefined'
      ? []
      : _parse(payload)

  games[game.id] = game

  return Object.values(games).map(format).join(',')
}

export const updatePokemon = ({ customId, customName, ...p } = {}) => {
  activeGame.subscribe((gameId) => {
    getGameStore(gameId).update(
      patch({
        [customId || p.location]: p
      })
    )
  })
}

export const killPokemon = ({ customId, customName, ...p }) => {
  activeGame.subscribe((gameId) => {
    getGameStore(gameId).update(
      patch({
        [customId || p.location]: { ...p, status: 5 }
      })
    )
  })
}

export const getGen = (_) =>
  new Promise((resolve) => {
    activeGame.subscribe((gameId) => {
      savedGames.subscribe(
        parse((games) => {
          resolve(games[gameId]?.game)
        })
      )
    })
  })

export const getGame = (id) =>
  createWritable(
    IDS.game(id),
    (val) => {
      if (!browser) return
      if (!val) return
      localStorage.setItem(IDS.game(id), val)
    },
    {}
  )

export const readTeam = (data) => {
  return (data.__team || []).filter((i) => i)
}

export const readTeams = (data) => {
  return data.__teams || []
}

export const readStarter = (data) => data.__starter || 'fire'

export const readBox = (data) => {
  const customIdMap = toObj(data.__custom, 'id')

  return Object.entries(data)
    .filter(([, i]) => i.pokemon)
    .filter(([, { status }]) => NuzlockeGroups.Available.includes(status))
    .map(([id, p]) => {
      // Read custom location data from data.__custom
      let custom
      if (customIdMap?.[id]) custom = customIdMap?.[id]

      return custom ? { ...p, customId: custom.id, customName: custom.name } : p
    })
}

export const getBox = (cb = () => {}) =>
  activeGame.subscribe((gameId) => {
    if (browser && !gameId) return (window.location = '/')

    getGameStore(gameId).subscribe(read((data) => cb(readBox(data))))
  })

export const patch = (payload) => (data) =>
  JSON.stringify({
    ...JSON.parse(data),
    ...payload
  })

export const addlocation = (payload) => (data) =>
  JSON.stringify({
    ...JSON.parse(data),
    __custom: (JSON.parse(data).__custom || []).concat(payload)
  })

export const removelocation = (id) => (data) =>
  JSON.stringify({
    ...JSON.parse(data),
    __custom: (JSON.parse(data).__custom || []).filter((i) => i.id !== id)
  })

export const hidelocation = (id) => (data) =>
  JSON.stringify({
    ...JSON.parse(data),
    [id]: {},
    __hidden: (JSON.parse(data).__hidden || []).concat(id)
  })

export const patchlocation = (payload) => (data) =>
  JSON.stringify({
    ...JSON.parse(data),
    __custom: JSON.parse(data).__custom.map((c) =>
      c.id === payload.id ? { ...c, ...payload } : c
    )
  })

/** Team handlers */
// FIXME: Teams a list of box indexes rather than pokemon indexs
export const getTeams = (cb = () => {}) =>
  activeGame.subscribe((gameId) => {
    getGameStore(gameId).subscribe(
      read((data) => {
        cb({
          team: data.__team || [],
          teams: data.__teams || []
        })
      })
    )
  })

const _read = (payload) => {
  if (!payload) return
  try {
    return typeof payload === 'string' ? JSON.parse(payload) : {}
  } catch (e) {
    console.error(e)
    return {}
  }
}

export const read = (cb) => (payload) => cb(_read(payload) || {})

const _parse = parseSaves

export const parse =
  (cb = () => {}) =>
  (gameData) =>
    cb(_parse(gameData))

export const format = formatSave

export const summarise =
  (cb = (_) => {}) =>
  ({ __starter, __custom, __team = [], __teams, ...data }) => {
    const pkmn = Object.values(data)
    cb({
      available: pkmn.filter(
        (i) => i?.pokemon && NuzlockeGroups.Available.includes(i?.status)
      ),
      deceased: pkmn.filter(
        (i) => i?.pokemon && NuzlockeGroups.Dead.includes(i?.status)
      ),
      team: __team.map((id) => data?.[id]?.pokemon).filter((i) => i)
    })
  }

if (typeof window !== 'undefined')
  window.nz = {
    size: function () {
      var _lsTotal = 0,
        _xLen,
        _x
      for (_x in localStorage) {
        if (!localStorage.hasOwnProperty(_x)) {
          continue
        }
        _xLen = (localStorage[_x].length + _x.length) * 2
        _lsTotal += _xLen
        console.log(
          _x.substr(0, 50) + ' = ' + (_xLen / 1024).toFixed(2) + ' KB'
        )
      }
      console.log('Total = ' + (_lsTotal / 1024).toFixed(2) + ' KB')
    },
    saves: function () {
      return [
        window.localStorage.getItem(IDS.saves),
        _parse(window.localStorage.getItem(IDS.saves))
      ]
    },
    getGame: function (id) {
      const data = JSON.parse(
        window.localStorage[`nuzlocke.${window.localStorage['nuzlocke']}`]
      )
      return id ? data[id] : data
    },
    getCustom: function () {
      const data = nz.getGame()
      const custom = data.__custom || []
      return [custom, custom.map((it) => data[it.id])]
    },
    getCaught: function () {
      const data = nz.getGame()
      return Object.values(data).filter((i) => i.status === 1)
    },
    getDead: function () {
      const data = nz.getGame()
      return Object.values(data).filter((i) => i.status === 5)
    },
    resetProgress: function () {
      const id = `nuzlocke.${window.localStorage['nuzlocke']}`
      if (!id) return 'Not sure'

      const { __teams, ...data } = JSON.parse(window.localStorage[id])
      window.localStorage.setItem(id, JSON.stringify({ ...data, __teams: [] }))
    }
  }
