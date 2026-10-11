<script>
  // Reusable notes (routes, bosses, checklist, lessons) that carry across
  // attempts, plus the current attempt's own notes and checklist ticks.
  // Links: ?tab=routes|bosses|checklist|lessons|attempt, &ref=<routes.json
  // route name or boss id>, &name=, &pokemon=, &attempt=<attempt id>
  // The game page shows the same route/boss notes in a side panel.
  import { onMount } from 'svelte'
  import { page } from '$app/stores'

  import { Expanded as Games } from '$lib/data/games.js'
  import { forGame, findByRef, PRIORITIES } from '$lib/history/knowledge'

  import Styles from '$c/History/Styles.svelte'
  import NoteEntry from '$c/History/NoteEntry.svelte'
  import EntryDetails from '$c/History/EntryDetails.svelte'
  import Lessons from '$c/History/Lessons.svelte'
  import { getNotes, refOptions, entryFields, attemptLabel } from '$c/History/notes-store'

  const TABS = [
    { val: 'bosses', label: 'Bosses' },
    { val: 'routes', label: 'Routes' },
    { val: 'checklist', label: 'Checklist' },
    { val: 'lessons', label: 'Lessons' },
    { val: 'attempt', label: 'This attempt' }
  ]
  const q = $page.url.searchParams
  let tab = TABS.some((t) => t.val === q.get('tab')) ? q.get('tab') : 'bosses'

  let notes = null,
    routeList = [],
    openId = null,
    draft = null // a new, unsaved route/boss entry

  onMount(async () => {
    notes = getNotes()
    notes.reload()
    const pid = $notes.game && Games[$notes.game]?.pid
    if (pid)
      try {
        const res = await fetch(`/api/route/${pid}.json`)
        if (res.ok) routeList = await res.json()
      } catch (e) {
        console.error('Could not load the route list', e)
      }
    openFromQuery()
  })

  // Opens (or starts) the note a game-page card linked to
  const openFromQuery = () => {
    const ref = q.get('ref')
    if (!ref || !['routes', 'bosses'].includes(tab)) return
    const existing = findByRef($notes.knowledge, tab, $notes.game, ref)
    if (existing) openId = existing.id
    else {
      const fromList = refOptions(routeList, tab).find((o) => o.value === ref)
      draft = notes.newEntry(tab, { ref, name: q.get('name') || fromList?.name || ref })
    }
  }

  const saveDraft = (section) => (e) => {
    if (notes.upsertEntry(section, e.detail)) {
      openId = e.detail.id
      draft = null
    }
  }

  $: s = notes ? $notes : null
  $: run = s?.run
  $: game = s?.game
  $: knowledge = s?.knowledge
  $: canWriteAttempt = !!s?.canWriteAttempt
  $: done = (id) => !!s?.attempt?.checklist[id]

  let attemptNotes = null
  $: if (s?.attempt && attemptNotes === null) attemptNotes = s.attempt.notes
  let notesSaved = false
  const saveAttemptNotes = () => (notesSaved = notes.saveAttemptNotes(attemptNotes))

  // ---- Options and labels
  $: routes = knowledge ? forGame(knowledge.routes, game) : []
  $: bosses = knowledge ? forGame(knowledge.bosses, game) : []
  $: objectives = knowledge ? forGame(knowledge.objectives, game).slice().sort((a, b) => PRIORITIES.indexOf(a.priority) - PRIORITIES.indexOf(b.priority)) : []
  $: lessons = knowledge ? forGame(knowledge.lessons, game).slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)) : []
  $: routeOpts = routes.map((r) => ({ value: r.id, label: r.name }))
  $: bossOpts = bosses.map((b) => ({ value: b.id, label: b.name }))
  $: attemptOpts = s ? [...(run ? [run] : []), ...s.archives].map((a) => ({ value: a.id, label: attemptLabel(s, a.id) })) : []
  $: routeFields = entryFields('routes', routeList, s?.archives || [])
  $: bossFields = entryFields('bosses', routeList, s?.archives || [])

  const nameOf = (list, id) => list.find((e) => e.id === id)?.name
  const describeLesson = (l) =>
    [
      l.routeId && `Route: ${nameOf(knowledge.routes, l.routeId) || '?'}`,
      l.bossId && `Boss: ${nameOf(knowledge.bosses, l.bossId) || '?'}`,
      l.pokemon && `Pokémon: ${l.pokemon}`,
      l.attemptId && `Attempt: ${attemptLabel(s, l.attemptId)}`
    ]
      .filter(Boolean)
      .join(' · ')

  // Checklist objectives
  let objForm = { name: '', priority: 'normal', routeId: null, bossId: null, notes: '' }
  const addObjective = () => {
    if (!objForm.name.trim()) return
    if (notes.addObjective({ ...objForm, name: objForm.name.trim() })) objForm = { name: '', priority: 'normal', routeId: null, bossId: null, notes: '' }
  }
  const removeObjective = (o) => window.confirm(`Delete “${o.name}” from the checklist? Ticks in archived attempts are kept.`) && notes.removeObjective(o.id)

  $: lessonPrefill = { pokemon: q.get('pokemon') || '', attemptId: q.get('attempt') || run?.id || null }
</script>

<svelte:head>
  <title>Nuzlocke Tracker | Notes</title>
</svelte:head>

<Styles />

<div class="nz-page container mx-auto pb-24">
  <main class="p-container flex max-w-3xl flex-col gap-y-4 pt-20 md:pt-24">
    <header class="flex flex-col gap-y-1">
      <h1 class="text-2xl font-bold">Notes</h1>
      <p class="text-sm opacity-75">
        Your own route, boss and checklist notes. They carry over to every new attempt{game ? ` of ${game}` : ''}; checklist ticks belong to the current attempt only.
      </p>
    </header>

    {#if s?.loadError}<p class="nz-alert" role="alert">{s.loadError}</p>{/if}
    {#if s?.error}<p class="nz-alert" role="alert" data-testid="notes-error">{s.error}</p>{/if}

    <div class="flex gap-1 overflow-x-auto border-b-2 border-gray-200 pb-px dark:border-gray-700" role="tablist">
      {#each TABS as t}
        <button
          role="tab"
          aria-selected={tab === t.val}
          class="shrink-0 rounded-t-lg px-3 py-2 text-sm"
          class:font-bold={tab === t.val}
          class:bg-gray-100={tab === t.val}
          class:dark:bg-gray-800={tab === t.val}
          on:click={() => ((tab = t.val), (draft = null))}>{t.label}</button
        >
      {/each}
    </div>

    {#if !knowledge}
      <p class="nz-muted">Loading…</p>
    {:else if tab === 'routes' || tab === 'bosses'}
      {@const section = tab}
      {@const list = section === 'routes' ? routes : bosses}
      <div class="flex flex-wrap gap-2">
        <button class="nz-btn" on:click={() => (draft = notes.newEntry(section))} data-testid="note-new">
          {section === 'routes' ? 'New route or location' : 'New boss or miniboss'}
        </button>
      </div>
      {#if draft}
        {#key draft.id}
          <NoteEntry entry={draft} isNew open fields={section === 'routes' ? routeFields : bossFields} on:save={saveDraft(section)} on:cancel={() => (draft = null)} />
        {/key}
      {/if}
      {#each list as entry (entry.id)}
        <EntryDetails {notes} {section} {entry} open={openId === entry.id} fields={section === 'routes' ? routeFields : bossFields} pokemon={q.get('pokemon') || ''} />
      {:else}
        {#if !draft}
          <p class="nz-muted">
            {section === 'routes'
              ? 'No route notes yet. Open one from a route on the game page, or add a custom location here.'
              : 'No boss notes yet. Open one from a boss on the game page, or add a custom miniboss here.'}
          </p>
        {/if}
      {/each}
    {:else if tab === 'checklist'}
      {#if !run}<p class="nz-muted">Start or load a run to tick items off.</p>{/if}
      {#each objectives as o (o.id)}
        <div class="nz-card flex items-start gap-x-3" data-testid="objective">
          <input type="checkbox" class="mt-0.5 h-6 w-6 shrink-0" aria-label="Done: {o.name}" disabled={!canWriteAttempt} checked={done(o.id)} on:change={(e) => notes.toggle(o.id, e.currentTarget.checked)} />
          <div class="min-w-0 flex-1 text-sm">
            <p class="font-medium" class:line-through={done(o.id)}>
              {o.name}
              {#if o.priority !== 'normal'}<span class="nz-chip {o.priority === 'high' ? 'nz-status-lost' : 'nz-status-archived'} ml-1">{o.priority}</span>{/if}
            </p>
            {#if o.routeId || o.bossId}<p class="text-xs opacity-60">{[nameOf(knowledge.routes, o.routeId), nameOf(knowledge.bosses, o.bossId)].filter(Boolean).join(' · ')}</p>{/if}
            {#if o.notes}<p class="whitespace-pre-line text-xs">{o.notes}</p>{/if}
          </div>
          <button class="nz-btn h-8 min-w-[2rem] border-0 px-1 text-xs opacity-60" aria-label="Delete {o.name}" on:click={() => removeObjective(o)}>✕</button>
        </div>
      {:else}
        <p class="nz-muted">No checklist items yet. Items you add here stay for future attempts; ticks reset with each new attempt.</p>
      {/each}
      <form class="nz-card flex flex-col gap-y-2" on:submit|preventDefault={addObjective}>
        <label class="nz-label">New item or objective <input class="nz-input" bind:value={objForm.name} maxlength="200" placeholder="e.g. Get the Exp. Share" data-testid="objective-name" /></label>
        <div class="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <label class="nz-label">Priority <select class="nz-input" bind:value={objForm.priority}>{#each PRIORITIES as p}<option value={p}>{p}</option>{/each}</select></label>
          <label class="nz-label">Route <select class="nz-input" bind:value={objForm.routeId}><option value={null}>—</option>{#each routeOpts as o}<option value={o.value}>{o.label}</option>{/each}</select></label>
          <label class="nz-label">Boss <select class="nz-input" bind:value={objForm.bossId}><option value={null}>—</option>{#each bossOpts as o}<option value={o.value}>{o.label}</option>{/each}</select></label>
        </div>
        <label class="nz-label">Notes (optional) <textarea class="nz-input min-h-[3rem]" bind:value={objForm.notes} maxlength="8000" /></label>
        <button class="nz-btn w-fit" type="submit" disabled={!objForm.name.trim()} data-testid="objective-add">Add to checklist</button>
      </form>
    {:else if tab === 'lessons'}
      <Lessons
        {lessons}
        full
        prefill={lessonPrefill}
        routes={routeOpts}
        bosses={bossOpts}
        attempts={attemptOpts}
        pokemon={s.trackerPokemon}
        describe={describeLesson}
        on:add={(e) => notes.addLesson(e.detail)}
        on:delete={(e) => notes.deleteLesson(e.detail)}
      />
      {#if !lessons.length}<p class="nz-muted">No lessons yet. Lessons linked to a route or boss also appear in its notes.</p>{/if}
    {:else if tab === 'attempt'}
      {#if !run}
        <p class="nz-muted">There’s no active run. <a class="underline" href="/saves">Load a game</a> to write attempt notes.</p>
      {:else}
        <section class="nz-card flex flex-col gap-y-2">
          <h2 class="font-bold">{run.name} <span class="text-sm font-normal opacity-60">· attempt {+run.attempts || 1}</span></h2>
          <p class="nz-muted">
            These notes belong to this attempt only and are archived with it. {Object.keys(s.attempt?.checklist || {}).length} checklist item(s) ticked.
          </p>
          <label class="nz-label">
            <span class="sr-only">Attempt notes</span>
            <textarea aria-label="Attempt notes" class="nz-input min-h-[10rem]" bind:value={attemptNotes} on:input={() => (notesSaved = false)} maxlength="20000" disabled={!canWriteAttempt} data-testid="attempt-notes" />
          </label>
          <div class="flex flex-wrap items-center gap-2">
            <button class="nz-btn primary" disabled={!canWriteAttempt} on:click={saveAttemptNotes} data-testid="attempt-notes-save">Save notes</button>
            {#if notesSaved}<span class="nz-muted" role="status">Saved.</span>{/if}
            <a class="nz-btn ml-auto" href="/history">Attempt history</a>
          </div>
        </section>
      {/if}
    {/if}
  </main>
</div>
