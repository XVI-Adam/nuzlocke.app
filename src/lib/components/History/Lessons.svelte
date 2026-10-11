<script>
  // A list of lessons with an add form. `fixed` links (e.g. { bossId }) are
  // applied to new lessons; `full` shows every link as a choice.
  import { createEventDispatcher } from 'svelte'

  export let lessons = [],
    fixed = {},
    full = false,
    prefill = {}, // initial values for the add form
    routes = [], // [{ value, label }] knowledge route entries
    bosses = [],
    attempts = [], // [{ value, label }] current + archived attempts
    pokemon = [], // suggestions
    describe = () => '' // lesson -> link summary

  const dispatch = createEventDispatcher()
  const blank = () => ({ text: '', routeId: null, bossId: null, pokemon: '', attemptId: null, ...prefill })
  let form = blank()

  const add = () => {
    if (!form.text.trim()) return
    dispatch('add', { ...form, ...fixed, text: form.text.trim(), pokemon: form.pokemon?.trim() || null })
    form = blank()
  }
  const del = (l) => window.confirm('Delete this lesson?') && dispatch('delete', l.id)
</script>

<div class="flex flex-col gap-y-2">
  {#each lessons as l (l.id)}
    <div class="flex items-start gap-x-2 rounded-lg bg-gray-100 px-3 py-2 text-sm dark:bg-gray-800" data-testid="lesson">
      <div class="min-w-0 flex-1">
        <p class="whitespace-pre-line">{l.text}</p>
        {#if describe(l)}<p class="mt-0.5 text-xs opacity-60">{describe(l)}</p>{/if}
      </div>
      <button class="nz-btn h-8 min-w-[2rem] border-0 px-1 text-xs opacity-60" aria-label="Delete lesson" on:click={() => del(l)}>✕</button>
    </div>
  {/each}

  <form class="flex flex-col gap-y-2" on:submit|preventDefault={add}>
    <label class="nz-label">
      <span class="sr-only">New lesson</span>
      <textarea class="nz-input min-h-[3rem]" bind:value={form.text} maxlength="8000" placeholder="Add a lesson learned…" data-testid="lesson-text" />
    </label>
    {#if full}
      <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <label class="nz-label">Route
          <select class="nz-input" bind:value={form.routeId}><option value={null}>—</option>{#each routes as o}<option value={o.value}>{o.label}</option>{/each}</select>
        </label>
        <label class="nz-label">Boss
          <select class="nz-input" bind:value={form.bossId}><option value={null}>—</option>{#each bosses as o}<option value={o.value}>{o.label}</option>{/each}</select>
        </label>
        <label class="nz-label">Pokémon
          <input class="nz-input" bind:value={form.pokemon} list="lesson-pokemon" maxlength="64" />
          <datalist id="lesson-pokemon">{#each pokemon as p}<option value={p} />{/each}</datalist>
        </label>
        <label class="nz-label">Attempt
          <select class="nz-input" bind:value={form.attemptId}><option value={null}>—</option>{#each attempts as o}<option value={o.value}>{o.label}</option>{/each}</select>
        </label>
      </div>
    {/if}
    <button class="nz-btn w-fit" type="submit" disabled={!form.text.trim()} data-testid="lesson-add">Add lesson</button>
  </form>
</div>
