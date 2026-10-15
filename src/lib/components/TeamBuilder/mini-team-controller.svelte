<script>
  import { IconButton, Icon } from '$c/core'
  import { X, Ball, Plus } from '$icons'

  import { MiniTeam } from './'
  import { toObj } from '$utils/obj'
  import { locid as pokeLocId } from '$utils/pokemon'
  import { fade } from 'svelte/transition'
  import {
    getGameStore,
    readdata,
    readBox,
    readTeam,
    read,
    patch
  } from '$lib/store'
  let teamData = [],
    boxData = [],
    boxLength = 0,
    setTeam = (_) => _,
    gameStore,
    seenTeam

  async function setup() {
    const [, , id] = readdata()

    gameStore = getGameStore(id)
    gameStore.subscribe(
      read((data) => {
        seenTeam = Object.hasOwnProperty.call(data, '__team')
        teamData = readTeam(data)
        boxData = readBox(data).reduce(
          (acc, it) => ({ ...acc, [pokeLocId(it)]: it }),
          {}
        )
        boxLength = readBox(data).length
      })
    )

    setTeam = (data) => gameStore.update(patch({ __team: data.slice(0, 6) }))
  }

  const locid = (evt) => pokeLocId(evt.detail.data)
  const toarray = (data) => (teamData ? [].concat(teamData) : [])

  const onteamadd = (evt) => {
    setTeam(
      toarray(teamData)
        .filter((i) => i !== locid(evt))
        .concat(locid(evt))
    )
  }

  const onteamremove = (evt) => {
    setTeam(toarray(teamData).filter((i) => i !== locid(evt)))
  }

  const onteamreplace = (evt) => {
    if (toarray(teamData).includes(locid(evt)))
      return onteamswap({
        detail: {
          ...evt.detail,
          srcId: toarray(teamData).findIndex((id) => id === locid(evt))
        }
      })

    setTeam(
      toarray(teamData).map((id, i) =>
        i === +evt.detail.targetId ? locid(evt) : id
      )
    )
  }

  const onteamswap = (evt) => {
    const targetId = Math.min(evt.detail.targetId, toarray(teamData).length - 1)
    const srcId = evt.detail.srcId

    setTeam(
      toarray(teamData).map((it, i, arr) => {
        if (i === targetId) return arr[srcId]
        if (i === srcId) return arr[targetId]
        return it
      })
    )
  }

  const onteamclear = () => setTeam([])

  $: mons = (teamData || []).map((t) => boxData[t]).filter((i) => i)
</script>

{#await setup() then}
  <div transition:fade|local={{ delay: 500 }}>
    <MiniTeam
      class="transform md:pl-8 {$$restProps.class || ''}"
      iconKey="pokemon"
      on:add={onteamadd}
      on:swap={onteamswap}
      on:remove={onteamremove}
      on:replace={onteamreplace}
      {mons}
    />

    {#if !mons.length && boxLength}
      <small
        in:fade={{ duration: 500 }}
        out:fade={{ duration: 200 }}
        class:hidden={seenTeam}
        class="absolute left-1/2 mb-1 w-full -translate-x-1/2 translate-y-full italic text-gray-500 md:bottom-2 md:block"
      >
        Drag Pokémon from your box or click add to team
        <span class="relative">
          <Icon
            class="absolute top-0.5 -right-4 scale-110 transform"
            inline
            icon={Ball}
          />
          <Icon
            class="absolute -right-6 -top-0.5 -translate-x-0.5 scale-75 transform rounded-full bg-white dark:bg-gray-800"
            inline
            icon={Plus}
          />
        </span>
      </small>
    {/if}

    <IconButton
      on:click={onteamclear}
      title="Clear your team"
      disabled={!mons?.length}
      borderless
      containerClassName=" rounded-full !border-gray-900 z-50 ml-1 md:ml-0 md:translate-x-1/2 md:mt-1"
      src={X}
    />
  </div>
{/await}

<style>
  div {
    @apply relative mx-auto flex w-auto items-center text-center;
  }

  @media (max-width: theme('screens.md')) {
    div {
      @apply fixed w-full justify-center border-t-2 border-gray-200 bg-white/50 px-3 pt-3 pb-3 backdrop-blur-sm;
      /* sits on the phone tab bar (or the home indicator without one) */
      bottom: calc(var(--tabbar-h) + var(--safe-bottom));
    }

    :global(.dark) div {
      @apply border-gray-900 bg-gray-800/80;
    }
  }
</style>
