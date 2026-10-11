<script>
  // One route or boss note: a summary card that expands to show all fields,
  // with an edit form. Saving/deleting is done by the parent (on:save, on:delete).
  import { createEventDispatcher } from 'svelte'

  export let entry,
    fields = [], // [{ key, label, type: 'text' | 'textarea' | 'select' | 'attempts', options?: [{ value, label }] }]
    open = false,
    isNew = false,
    title = '',
    collapsible = true // false: always expanded, no summary toggle (notes panel)

  const dispatch = createEventDispatcher()
  let draft = isNew ? { ...entry, attemptIds: [...(entry.attemptIds || [])] } : null
  let el

  $: if (open && collapsible && el) el.scrollIntoView({ block: 'start' })

  const edit = () => (draft = { ...entry, attemptIds: [...(entry.attemptIds || [])] })
  const cancel = () => (isNew ? dispatch('cancel') : (draft = null))
  const save = () => {
    if (!String(draft.name || '').trim()) return
    dispatch('save', { ...draft, name: draft.name.trim() })
    draft = null
  }
  const del = () => {
    if (window.confirm(`Delete the notes for “${entry.name}”? Lessons and checklist items linked to it are kept.`)) dispatch('delete', entry.id)
  }
  const toggleAttempt = (id) =>
    (draft.attemptIds = draft.attemptIds.includes(id) ? draft.attemptIds.filter((a) => a !== id) : draft.attemptIds.concat(id))

  const label = (f, v) => f.options?.find((o) => o.value === v)?.label || v
  $: filled = fields.filter((f) => (f.type === 'attempts' ? entry.attemptIds?.length : entry[f.key]))
</script>

<article bind:this={el} class="nz-card flex scroll-mt-24 flex-col gap-y-2" data-testid="note-entry">
  {#if draft}
    <form class="flex flex-col gap-y-3" on:submit|preventDefault={save}>
      <label class="nz-label">Name <input class="nz-input" bind:value={draft.name} required maxlength="200" data-testid="note-name" /></label>
      {#each fields as f}
        {#if f.type === 'textarea'}
          <label class="nz-label">{f.label}<textarea class="nz-input" bind:value={draft[f.key]} maxlength="8000" data-testid="note-{f.key}" /></label>
        {:else if f.type === 'select'}
          <label class="nz-label">
            {f.label}
            <select class="nz-input" bind:value={draft[f.key]}>
              <option value={null}>None (custom)</option>
              {#each f.options as o}<option value={o.value}>{o.label}</option>{/each}
            </select>
          </label>
        {:else if f.type === 'attempts'}
          {#if f.options.length}
            <fieldset class="flex flex-col gap-y-1 text-sm">
              <legend class="font-medium">{f.label}</legend>
              {#each f.options as o}
                <label class="flex items-center gap-x-2"><input type="checkbox" class="h-5 w-5" checked={draft.attemptIds.includes(o.value)} on:change={() => toggleAttempt(o.value)} />{o.label}</label>
              {/each}
            </fieldset>
          {/if}
        {:else}
          <label class="nz-label">{f.label}<input class="nz-input" bind:value={draft[f.key]} maxlength="200" /></label>
        {/if}
      {/each}
      <div class="flex flex-wrap gap-2">
        <button class="nz-btn primary" type="submit" data-testid="note-save">Save</button>
        <button class="nz-btn" type="button" on:click={cancel}>Cancel</button>
      </div>
    </form>
  {:else}
    <svelte:element this={collapsible ? 'details' : 'div'} open={collapsible ? open : undefined}>
      {#if collapsible}
        <summary class="flex cursor-pointer list-none flex-wrap items-center gap-x-2 gap-y-1">
          <h3 class="text-base font-bold">{entry.name || 'Untitled'}</h3>
          {#if title}<span class="nz-muted">{title}</span>{/if}
        </summary>
      {/if}
      <div class="flex flex-col gap-y-2" class:mt-2={collapsible}>
        {#each filled as f}
          <div>
            <p class="text-xs font-bold uppercase tracking-wide opacity-60">{f.label}</p>
            {#if f.type === 'attempts'}
              <ul class="text-sm">
                {#each entry.attemptIds as id}<li><a class="underline" href="/history/{id}">{label(f, id)}</a></li>{/each}
              </ul>
            {:else}
              <p class="whitespace-pre-line text-sm">{f.type === 'select' ? label(f, entry[f.key]) : entry[f.key]}</p>
            {/if}
          </div>
        {:else}
          <p class="nz-muted">Nothing written yet.</p>
        {/each}
        <slot />
        <div class="flex flex-wrap gap-2 pt-1">
          <button class="nz-btn" on:click={edit} data-testid="note-edit">Edit</button>
          <button class="nz-btn danger" on:click={del}>Delete</button>
        </div>
      </div>
    </svelte:element>
  {/if}
</article>
