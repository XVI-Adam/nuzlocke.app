<script>
  import { afterUpdate, onMount, tick } from 'svelte'
  import { fade } from 'svelte/transition'
  import {
    patch,
    addlocation,
    removelocation,
    hidelocation,
    read
  } from '$lib/store'

  import { toDbLocation } from '$utils/link'
  import { insertList } from '$utils/arr'
  import { shortuuid } from '$utils/uuid'
  import { slugify } from '$utils/string'

  import { Tooltip } from '$lib/components/core'
  import CustomLocation from './CustomLocation.svelte'
  import StarterType from '$lib/components/starter-type.svelte'
  import GymCard from '$lib/components/gym-card.svelte'
  import PokemonSelector from '$lib/components/pokemon-selector.svelte'

  import {
    hideRouteF,
    isRoute,
    isGym,
    isStarter,
    isCustom,

    showStarterRoute,
    showRoute,
    showGym,
    showCustom
  } from './_predicates'
  import { filterEntry } from './_filters'
  import { findByRef, noteCount } from '$lib/history/knowledge'
  import { getNotes } from '$lib/components/History/notes-store'

  export let route,
    game,
    filters,
    search,
    progress = '',
    className = ''
  const { store, key, data } = game

  let starter = data.__starter || 'fire'

  /** The player's notes for each route/boss card, opened in a side panel */
  let notes = null,
    NotesPanel = null,
    panelTarget = null,
    panelTrigger = null
  onMount(() => (notes = getNotes()))
  const openNotes = (target) => {
    panelTrigger = document.activeElement
    import('$lib/components/History/NotesPanel.svelte').then((m) => {
      NotesPanel = m.default
      panelTarget = target
    })
  }
  const closeNotes = async () => {
    panelTarget = null
    await tick() // the page is no longer inert once the panel is gone
    panelTrigger?.focus?.()
  }
  const notesFor = (n, section, ref, name) =>
    n && ref
      ? {
          href: `/notes?tab=${section}&ref=${encodeURIComponent(ref)}&name=${encodeURIComponent(name || ref)}`,
          count: noteCount(n.knowledge, section, findByRef(n.knowledge, section, key, ref)),
          open: (pokemon) => openNotes({ section, ref, name: name || ref, pokemon })
        }
      : null
  let element

  /** Custom route handlers & Empty routes */
  let custom = [],
    hidden = [],
    bossTeamIds = [],
    hideRoute = (_) => false
  store.subscribe(
    read((d) => {
      if (!custom.length && d.__custom?.length) custom = d.__custom
      if (!hidden.length && d.__hidden?.length) hidden = d.__hidden

      bossTeamIds = (d.__teams || []).map((i) => i.id)
      hideRoute = hideRouteF(d)
    })
  )

  const onnewlocation = (e) => {
    const index = e.detail.id + 1
    const loc = { type: 'custom', name: '', id: shortuuid(), index }
    custom = custom.concat(loc)
    store.update(addlocation(loc))
  }

  const ondeletelocation = (e) => {
    const id = e.detail.id
    custom = custom.filter((i) => i.id !== id)
    store.update(removelocation(id))
  }

  const onhidelocation = (e) => {
    const id = e.detail.id
    store.update(hidelocation(id))
  }

  /** Event Handlers */
  const setstarter = (e) => {
    starter = e.detail.value
    game.store.update(patch({ __starter: starter }))
  }

  /** Sets the starter (rival teams) as if picked in the starter selector */
  export const usestarter = (value) => setstarter({ detail: { value } })

  export const setnav = (e) =>
    setloc(`boss-${e.detail.value}`, e.detail.value + 20)

  export const setroute =
    ({ name, id }) =>
    () =>
      setloc(`route-${name}`, id + 10)

  let scroll, ulRef
  const scrollToItem = (id) => {
    document.getElementById(id).scrollIntoView({
      behavior: 'smooth',
      block: 'center'
    })
  }

  const setloc = (id, i) => {
    document.getElementById(id) ? scrollToItem(id) : (scroll = id)
  }

  const locid = (p, i) => {
    return p.type === 'custom'
      ? slugify(`${p.type}-${p.name}-${p.id}`)
      : slugify(`${p.type}-${p.name}-${p.origPos}`)
  }

  afterUpdate(() => {
    if (!scroll) return
    setTimeout(scrollToItem.bind({}, scroll))
    scroll = null
  })

  $: routeList = insertList(route, custom)
</script>

<ul bind:this={ulRef} class="flex flex-col gap-y-0 lg:gap-y-2 {className}">
  {#each routeList as p, id (locid(p, id))}
    {@const hidden = !filterEntry(filters, search, game.data, progress - 1)(p)}

  {#if isStarter(p)}
      <li
        class="flex items-center gap-x-2"
        id="route-{p.name}"
        in:fade
        out:fade={{ duration: 100 }}
        class:hidden={hidden || !showStarterRoute(p, filters, hideRoute)}
      >
        <PokemonSelector
          {id}
          {store}
          encounters={p.encounters}
          type="starter"
          location="Starter"
          locationName="Starter"
          on:new={onnewlocation}
        >
          <div
            slot="location"
            class="-mr-1 flex flex-row-reverse items-center gap-x-2 lg:-ml-6 lg:flex-row"
          >
            <StarterType {key} on:select={setstarter} bind:starter />
            <p>
              Starter* <Tooltip
                >Selecting a starter type modifies Rival encounters.</Tooltip
              >
            </p>
          </div>
        </PokemonSelector>
      </li>
    {:else if isRoute(p)}
      <li
        class="location"
        id="route-{p.name}"
        in:fade
        out:fade={{ duration: 100 }}
        class:hidden={hidden || !showRoute(p, filters, hideRoute)}
      >
        <PokemonSelector
          {id}
          {store}
          infolink={key.startsWith('unbound') ? p.encounterDetails?.url : toDbLocation(key, p.name)}
          notes={notesFor($notes, 'routes', p.name, p.name)}
          location={p.name}
          encounters={p.encounters}
          encounterDetails={p.encounterDetails}
          on:hide={onhidelocation}
          on:new={onnewlocation}
        />
      </li>
    {:else if isCustom(p)}
      <li
        class="location flex items-center gap-x-2"
        id="custom-{p.index}"
        in:fade
        out:fade={{ duration: 100 }}
        class:hidden={hidden || !showCustom(p, filters, hideRoute)}
      >
        <PokemonSelector
          type="custom"
          locationName={p.name}
          location={p.id}
          {id}
          {store}
          on:new={onnewlocation}
          on:delete={ondeletelocation}
        >
          <svelte:fragment slot="location">
            <CustomLocation {store} id={p.id} />
          </svelte:fragment>
        </PokemonSelector>
      </li>
    {:else if isGym(p)}
      <li
        class="boss -mb-4 md:my-2"
        class:hidden={hidden || !showGym(p, filters)}
        id="boss-{id}"
        data-boss={p.value}
        in:fade
        out:fade={{ duration: 100 }}
      >
        <GymCard
          forceVs
          {starter}
          game={key}
          id={p.value}
          defeated={bossTeamIds.includes(p.value)}
          notes={notesFor($notes, 'bosses', p.value, p.boss || p.name)}
          check={p.bossCheck}
          location={p.name}
          type={p.group}
        />
      </li>
    {/if}
  {/each}
</ul>

{#if NotesPanel && panelTarget}
  <svelte:component this={NotesPanel} target={panelTarget} routeList={route} on:close={closeNotes} />
{/if}

<style>
  li {
    scroll-margin-top: 28px;
    @apply snap-start;
  }

  /* Subtle highlight of the card being worked on (focus) or pointed at */
  li.location,
  li.boss {
    border-radius: 0.75rem;
    transition: background-color 150ms, box-shadow 150ms;
  }
  li.location:focus-within,
  li.boss:focus-within {
    background-color: rgb(249 115 22 / 0.06);
    box-shadow: 0 0 0 6px rgb(249 115 22 / 0.06);
  }
  @media (hover: hover) {
    li.location:hover,
    li.boss:hover {
      background-color: rgb(127 127 127 / 0.06);
      box-shadow: 0 0 0 6px rgb(127 127 127 / 0.06);
    }
  }

  @media (min-width: theme('screens.md')) {
    li.location {
      scroll-margin-top: 32px;
    }
  }
</style>
