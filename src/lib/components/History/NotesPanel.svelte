<script>
  // Contextual notes for one route or boss on the game page: a side panel on
  // desktop, a bottom sheet on mobile. Same data and components as /notes.
  import { createEventDispatcher, onMount, tick } from 'svelte'
  import { fly, fade } from 'svelte/transition'

  import { findByRef } from '$lib/history/knowledge'
  import Styles from './Styles.svelte'
  import NoteEntry from './NoteEntry.svelte'
  import EntryDetails from './EntryDetails.svelte'
  import { getNotes, entryFields } from './notes-store'

  export let target, // { section: 'routes' | 'bosses', ref, name, pokemon? }
    routeList = []

  const dispatch = createEventDispatcher()
  const notes = getNotes()
  const query = '(min-width: 768px)' // Tailwind md: side panel, else bottom sheet
  let panel,
    draft = null,
    wide = window.matchMedia(query).matches // client-only component (lazy-loaded)

  $: s = $notes
  $: entry = findByRef(s.knowledge, target.section, s.game, target.ref)
  $: fields = entryFields(target.section, routeList, s.archives)
  $: kind = target.section === 'bosses' ? 'Boss notes' : 'Route notes'
  // A different card was opened while the panel is up
  $: target, (draft = null)

  const close = () => dispatch('close')
  const start = () => (draft = notes.newEntry(target.section, { ref: target.ref, name: target.name }))
  const saveDraft = (e) => {
    if (notes.upsertEntry(target.section, e.detail)) draft = null
  }
  const onkey = (e) => e.key === 'Escape' && close()

  onMount(async () => {
    const mq = window.matchMedia(query)
    const onchange = (e) => (wide = e.matches)
    mq.addEventListener?.('change', onchange)
    await tick()
    panel?.focus()
    return () => mq.removeEventListener?.('change', onchange)
  })
</script>

<svelte:window on:keydown={onkey} />
<Styles />

<!-- Mobile: dim the page behind the sheet; tapping it closes -->
<div class="fixed inset-0 z-[8990] bg-black/40 md:hidden" transition:fade={{ duration: 150 }} on:click={close} aria-hidden="true" />

<aside
  bind:this={panel}
  tabindex="-1"
  role="dialog"
  aria-modal={wide ? 'false' : 'true'}
  aria-labelledby="notes-panel-title"
  class="notes-panel fixed inset-x-0 bottom-0 z-[9000] md:z-[4900] flex max-h-[85vh] flex-col rounded-t-2xl bg-white shadow-2xl outline-none dark:bg-gray-900 md:inset-x-auto md:top-0 md:right-0 md:h-full md:max-h-none md:w-[26rem] md:rounded-none md:border-l-2 md:border-gray-200 md:dark:border-gray-700"
  transition:fly={wide ? { x: 420, duration: 200 } : { y: 400, duration: 200 }}
  data-testid="notes-panel"
>
  <div class="mx-auto mt-2 h-1.5 w-10 shrink-0 rounded-full bg-gray-300 dark:bg-gray-600 md:hidden" aria-hidden="true" />
  <header class="flex shrink-0 items-start gap-x-2 border-b-2 border-gray-100 px-4 py-3 dark:border-gray-800 md:pt-20">
    <div class="min-w-0 flex-1">
      <p class="text-xs font-bold uppercase tracking-wide opacity-60">{kind}</p>
      <h2 id="notes-panel-title" class="truncate text-lg font-bold">{entry?.name || target.name}</h2>
    </div>
    <button class="nz-btn !h-11 !w-11 shrink-0 text-lg" aria-label="Close notes" on:click={close} data-testid="notes-panel-close">✕</button>
  </header>

  <div class="flex flex-1 flex-col gap-y-3 overflow-y-auto overscroll-contain px-4 py-3 pb-8">
    {#if s.loadError}<p class="nz-alert" role="alert">{s.loadError}</p>{/if}
    {#if s.error}<p class="nz-alert" role="alert">{s.error}</p>{/if}

    {#if entry}
      {#key entry.id}
        <EntryDetails {notes} section={target.section} {entry} {fields} open collapsible={false} pokemon={target.pokemon || ''} />
      {/key}
    {:else if draft}
      <NoteEntry entry={draft} isNew open {fields} on:save={saveDraft} on:cancel={() => (draft = null)} />
    {:else}
      <p class="nz-muted">No notes for {target.name} yet. Notes you write here carry over to every future attempt.</p>
      <button class="nz-btn primary w-fit" on:click={start} data-testid="notes-panel-start">Write notes</button>
    {/if}

    <a class="mt-auto pt-2 text-sm underline opacity-75" href="/notes?tab={target.section}&ref={encodeURIComponent(target.ref)}&name={encodeURIComponent(target.name)}"
      >Open in the full Notes page</a
    >
  </div>
</aside>

<style>
  /* Phones: a sheet above the bottom team bar and search button. Desktop: a
     side panel under the fixed nav, so the nav stays usable */
  .notes-panel {
    padding-bottom: env(safe-area-inset-bottom);
  }
</style>
