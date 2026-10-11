<script>
  // One route or boss note with everything attached to it: preparation
  // checklist (ticks are per attempt), recorded fights in past attempts,
  // linked checklist items and lessons. Used by /notes and the game page's
  // notes panel; all writes go through the shared notes store.
  import { PIcon } from '$c/core'
  import NoteEntry from './NoteEntry.svelte'
  import Lessons from './Lessons.svelte'
  import { attemptLabel } from './notes-store'
  import { linkedTo } from '$lib/history/knowledge'

  export let notes, // notes store (notes-store.js)
    section, // 'routes' | 'bosses'
    entry,
    fields,
    open = false,
    collapsible = true,
    pokemon = '' // prefills new lessons

  $: s = $notes
  $: links = linkedTo(s.knowledge, section, entry.id)
  $: fights = section === 'bosses' && entry.ref ? notes.fightsFor(entry.ref) : []
  $: done = (id) => !!s.attempt?.checklist[id]
  // Current-attempt lessons first, then earlier attempts
  $: lessons = links.lessons
    .slice()
    .sort((a, b) => (b.attemptId === s.run?.id) - (a.attemptId === s.run?.id) || (b.createdAt || 0) - (a.createdAt || 0))

  let prepText = ''
  const addPrep = () => {
    const text = prepText.trim()
    if (text && notes.addPrep(entry, text)) prepText = ''
  }
  const removePrep = (item) => window.confirm('Remove this preparation item?') && notes.removePrep(entry, item.id)
  const describe = (l) =>
    [l.pokemon && `Pokémon: ${l.pokemon}`, l.attemptId && (l.attemptId === s.run?.id ? 'This attempt' : `From: ${attemptLabel(s, l.attemptId)}`)]
      .filter(Boolean)
      .join(' · ')
</script>

<NoteEntry
  {entry}
  {open}
  {collapsible}
  title={entry.ref ? '' : section === 'bosses' ? 'custom' : 'custom location'}
  {fields}
  on:save={(e) => notes.upsertEntry(section, e.detail)}
  on:delete={(e) => notes.removeEntry(section, e.detail)}
>
  {#if section === 'bosses'}
    <div>
      <p class="text-xs font-bold uppercase tracking-wide opacity-60">Preparation checklist</p>
      {#each entry.prep as item (item.id)}
        <div class="flex items-center gap-x-2 py-1 text-sm">
          <label class="flex min-h-[2.25rem] flex-1 items-center gap-x-2">
            <input
              type="checkbox"
              class="h-5 w-5 shrink-0"
              aria-label="Done: {item.text}"
              disabled={!s.canWriteAttempt}
              checked={done(item.id)}
              on:change={(e) => notes.toggle(item.id, e.currentTarget.checked)}
            />
            <span class:line-through={done(item.id)}>{item.text}</span>
          </label>
          <button class="nz-btn h-8 min-w-[2rem] border-0 px-1 text-xs opacity-60" aria-label="Remove {item.text}" on:click={() => removePrep(item)}>✕</button>
        </div>
      {:else}
        <p class="nz-muted">No preparation steps yet.</p>
      {/each}
      <form class="mt-1 flex gap-2" on:submit|preventDefault={addPrep}>
        <input class="nz-input" placeholder="Add a preparation step…" bind:value={prepText} maxlength="500" aria-label="New preparation step" />
        <button class="nz-btn" type="submit">Add</button>
      </form>
    </div>
    {#if fights.length}
      <div>
        <p class="text-xs font-bold uppercase tracking-wide opacity-60">Recorded fights in past attempts</p>
        {#each fights as f}
          <a class="flex items-center gap-x-1 text-sm underline" href="/history/{f.id}">
            {f.title}
            {#each f.team as name}<span class="relative h-8 w-8"><PIcon class="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2" {name} /></span>{/each}
          </a>
        {/each}
      </div>
    {/if}
  {/if}
  {#if links.objectives.length}
    <div>
      <p class="text-xs font-bold uppercase tracking-wide opacity-60">Checklist</p>
      {#each links.objectives as o (o.id)}
        <label class="flex min-h-[2.25rem] items-center gap-x-2 py-1 text-sm">
          <input
            type="checkbox"
            class="h-5 w-5"
            aria-label="Done: {o.name}"
            disabled={!s.canWriteAttempt}
            checked={done(o.id)}
            on:change={(e) => notes.toggle(o.id, e.currentTarget.checked)}
          />
          <span class:line-through={done(o.id)}>{o.name}</span>
        </label>
      {/each}
    </div>
  {/if}
  <div>
    <p class="text-xs font-bold uppercase tracking-wide opacity-60">Lessons ({lessons.length})</p>
    <Lessons
      {lessons}
      fixed={{ ...(section === 'routes' ? { routeId: entry.id } : { bossId: entry.id }), attemptId: s.run?.id || null }}
      prefill={{ pokemon }}
      {describe}
      on:add={(e) => notes.addLesson(e.detail)}
      on:delete={(e) => notes.deleteLesson(e.detail)}
    />
  </div>
</NoteEntry>
