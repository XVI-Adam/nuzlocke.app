<script>
  // Read-only view of one archived attempt. Renders from the frozen archive
  // blob only; just the title, status and summary can be edited.
  import { onMount } from 'svelte'
  import { page } from '$app/stores'

  import { readArchive, updateArchiveMeta, deleteArchive, summarizeAttempt, STATUSES, STATUS_LABELS } from '$lib/history/archive'
  import { readKnowledge } from '$lib/history/knowledge'
  import { normalizeSide } from '$lib/unbound/side'
  import { NuzlockeStates } from '$lib/data/states'
  import { capitalise } from '$lib/utils/string'

  import { PIcon } from '$c/core'
  import Styles from '$c/History/Styles.svelte'
  import Stats from '$c/History/Stats.svelte'
  import { fmtDate, fmtKnown } from '$c/History/format'
  import PartyMon from '$c/Unbound/PartyMon.svelte'
  import MonIcon from '$c/Unbound/MonIcon.svelte'

  const id = $page.params.id

  let meta = null,
    data = null,
    knowledge = null,
    error = null,
    loaded = false
  let form = null,
    saved = false,
    showDelete = false,
    deleteConfirmed = false

  const load = () => {
    try {
      const a = readArchive(localStorage, id)
      ;({ meta, data } = a || { meta: null, data: null })
      knowledge = readKnowledge(localStorage).knowledge
    } catch (e) {
      error = e.message
    }
    loaded = true
  }

  // Also re-read after changes from another device were synced in (an
  // edited title, or the attempt deleted elsewhere)
  onMount(() => {
    load()
    const onSynced = () => !form && load()
    window.addEventListener('nuzlocke:synced', onSynced)
    return () => window.removeEventListener('nuzlocke:synced', onSynced)
  })

  $: stats = data ? summarizeAttempt(data) : null
  $: tracker = data?.tracker || {}
  $: customNames = Object.fromEntries((tracker.__custom || []).map((c) => [c.id, c.name]))
  $: records = Object.entries(tracker)
    .filter(([k, r]) => !k.startsWith('__') && r && typeof r === 'object' && r.pokemon)
    .map(([key, r]) => ({ key, ...r, place: customNames[key] || r.location || key }))
  $: deaths = records.filter((r) => r.status === 5)
  $: team = (tracker.__team || []).map((k) => records.find((r) => r.key === k)).filter(Boolean)
  $: bossFights = Array.isArray(tracker.__teams) ? tracker.__teams : []
  $: side = data?.unbound ? normalizeSide(data.unbound) : null
  $: snap = side?.baseline?.snapshot
  $: lessons = (knowledge?.lessons || []).filter((l) => l.attemptId === id)
  $: checklistNames = Object.fromEntries([
    ...(knowledge?.objectives || []).map((o) => [o.id, o.name]),
    ...(knowledge?.bosses || []).flatMap((b) => b.prep.map((p) => [p.id, `${b.name}: ${p.text}`]))
  ])
  $: done = Object.entries(data?.attempt?.checklist || {})

  const name = (alias) => capitalise(String(alias || '').replace(/-/g, ' '))
  const statusLabel = (s) => NuzlockeStates[s]?.state || 'Unknown'
  const deathDetails = (death) =>
    Object.entries(death || {})
      .filter(([k, v]) => k !== 'epitaph' && v !== null && v !== '' && v !== undefined)
      .map(([k, v]) => [k, v && typeof v === 'object' ? Object.entries(v).map(([a, b]) => `${a} ${b}`).join(', ') : k === 'time' ? fmtDate(v, 'D MMM YYYY HH:mm') : v])

  const edit = () => {
    form = { title: meta.title, status: meta.status, summary: meta.summary }
    saved = false
  }
  const save = () => {
    error = null
    try {
      meta = updateArchiveMeta(localStorage, id, form)
      form = null
      saved = true
    } catch (e) {
      error = e.message
    }
  }
  const remove = () => {
    if (!deleteConfirmed) return
    try {
      deleteArchive(localStorage, id)
      window.location = '/history'
    } catch (e) {
      error = e.message
    }
  }
</script>

<svelte:head>
  <title>Nuzlocke Tracker | {meta?.title || 'Archived attempt'}</title>
</svelte:head>

<Styles />

<div class="nz-page container mx-auto pb-24">
  <main class="p-container flex max-w-3xl flex-col gap-y-6 pt-20 md:pt-24">
    <a href="/history" class="text-sm underline">← Attempt history</a>

    {#if error}<p class="nz-alert" role="alert">{error}</p>{/if}

    {#if loaded && !meta}
      <p class="nz-muted">This archived attempt doesn’t exist on this device.</p>
    {:else if meta}
      <header class="flex flex-col gap-y-1">
        <div class="flex flex-wrap items-center gap-2">
          <h1 class="text-2xl font-bold">{meta.title || meta.name || 'Untitled attempt'}</h1>
          <span class="nz-chip nz-status-{meta.status}">{STATUS_LABELS[meta.status]}</span>
          <span class="nz-chip nz-status-archived" title="Archived attempts can’t be changed by the tracker or save sync">Read-only</span>
        </div>
        <p class="nz-muted">
          {meta.name || 'Unknown run'} · attempt {meta.attemptNumber ?? 'unknown'} · {meta.game || 'unknown game'}<br />
          Started {fmtDate(meta.created)} · last played {fmtDate(meta.updated)} · archived {fmtDate(meta.archivedAt)}
        </p>
        {#if meta.summary && !form}<p class="whitespace-pre-line text-sm italic">{meta.summary}</p>{/if}

        {#if form}
          <div class="nz-card mt-2 flex flex-col gap-y-3">
            <label class="nz-label">Name <input class="nz-input" bind:value={form.title} maxlength="200" /></label>
            <label class="nz-label">
              Outcome
              <select class="nz-input" bind:value={form.status}>
                {#each STATUSES as s}<option value={s}>{STATUS_LABELS[s]}</option>{/each}
              </select>
            </label>
            <label class="nz-label">Summary <textarea class="nz-input" bind:value={form.summary} maxlength="4000" /></label>
            <div class="flex gap-2">
              <button class="nz-btn primary" on:click={save}>Save</button>
              <button class="nz-btn" on:click={() => (form = null)}>Cancel</button>
            </div>
          </div>
        {:else}
          <div class="mt-2 flex flex-wrap gap-2">
            <button class="nz-btn" on:click={edit} data-testid="edit-meta">Edit name, outcome & summary</button>
            <a class="nz-btn" href="/notes?tab=lessons&attempt={id}">Add a lesson from this attempt</a>
            {#if saved}<span class="nz-muted self-center" role="status">Saved.</span>{/if}
          </div>
        {/if}
      </header>

      {#if !data}
        <p class="nz-alert" role="alert">The archived data for this attempt is missing or unreadable on this device.</p>
      {:else}
        <section class="nz-card"><Stats {stats} /></section>

        <section aria-labelledby="enc">
          <h2 id="enc" class="mb-2 text-lg font-bold">Encounters ({records.length})</h2>
          {#if records.length}
            <ul class="divide-y divide-gray-200 dark:divide-gray-700" data-testid="archive-encounters">
              {#each records as r (r.key)}
                <li class="flex items-center gap-x-2 py-1.5 text-sm">
                  <span class="relative h-8 w-8 shrink-0"><PIcon class="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2" name={r.pokemon} /></span>
                  <span class="min-w-0 flex-1">
                    <b>{r.nickname || name(r.pokemon)}</b>
                    {#if r.nickname}<span class="opacity-60">· {name(r.pokemon)}</span>{/if}
                    {#if r.nature}<span class="opacity-60">· {capitalise(r.nature)}</span>{/if}
                    <br /><span class="text-xs opacity-60">{r.place}</span>
                  </span>
                  <span class="nz-chip nz-status-archived">{statusLabel(r.status)}</span>
                </li>
              {/each}
            </ul>
          {:else}<p class="nz-muted">No encounters were recorded.</p>{/if}
        </section>

        <section aria-labelledby="deaths">
          <h2 id="deaths" class="mb-2 text-lg font-bold">Deaths ({deaths.length})</h2>
          {#each deaths as d (d.key)}
            <div class="nz-card mb-2 text-sm">
              <b>{d.nickname || name(d.pokemon)}</b> <span class="opacity-60">· {name(d.pokemon)} · {d.place}</span>
              {#if d.death?.epitaph}<p class="mt-1 italic">{d.death.epitaph}</p>{/if}
              {#if deathDetails(d.death).length}
                <dl class="mt-1 text-xs opacity-75">
                  {#each deathDetails(d.death) as [k, v]}<div><dt class="inline">{k}:</dt> <dd class="inline">{v}</dd></div>{/each}
                </dl>
              {:else if !d.death}<p class="nz-muted">No death details were recorded.</p>{/if}
            </div>
          {:else}<p class="nz-muted">No deaths were recorded.</p>{/each}
        </section>

        <section aria-labelledby="team">
          <h2 id="team" class="mb-2 text-lg font-bold">Active team at archive time</h2>
          {#if team.length}
            <p class="text-sm">{team.map((r) => r.nickname || name(r.pokemon)).join(', ')}</p>
          {:else}<p class="nz-muted">No active team recorded.</p>{/if}
        </section>

        <section aria-labelledby="bosses">
          <h2 id="bosses" class="mb-2 text-lg font-bold">Boss fights recorded ({bossFights.length})</h2>
          {#each bossFights as b}
            <div class="mb-2 flex flex-wrap items-center gap-x-2 text-sm">
              <b>{b.name || b.id}</b>
              {#if b.group}<span class="opacity-60">{b.group}</span>{/if}
              {#each b.team || [] as m}
                <span class="relative h-8 w-8" title={m.sprite}><PIcon class="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2" name={m.sprite} /></span>
              {/each}
            </div>
          {:else}<p class="nz-muted">No boss fights were recorded.</p>{/each}
        </section>

        <section aria-labelledby="unbound">
          <h2 id="unbound" class="mb-2 text-lg font-bold">Unbound save (last accepted)</h2>
          {#if snap}
            <dl class="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-3">
              <div><dt class="nz-muted">Save index</dt><dd>#{snap.game.saveIndex}</dd></div>
              <div><dt class="nz-muted">Accepted</dt><dd>{fmtDate(side.baseline.acceptedAt, 'D MMM YYYY HH:mm')}</dd></div>
              <div><dt class="nz-muted">Source</dt><dd>{side.baseline.source || 'Unknown'}</dd></div>
              <div><dt class="nz-muted">Badges</dt><dd>{fmtKnown(snap.progress?.badges)}</dd></div>
              <div><dt class="nz-muted">Champion</dt><dd>{snap.progress?.champion === true ? 'Yes' : snap.progress?.champion === false ? 'No' : 'Unknown'}</dd></div>
              <div><dt class="nz-muted">Linked Pokémon</dt><dd>{Object.keys(side.links).length}</dd></div>
            </dl>
            {#if snap.party.length}
              <h3 class="mt-3 mb-1 text-sm font-bold">Party</h3>
              <div class="grid gap-2 sm:grid-cols-2">
                {#each snap.party as mon}{#if mon.hp}<PartyMon {mon} compact />{/if}{/each}
              </div>
            {/if}
            {#if snap.boxes.some((b) => b.mons.length)}
              <details class="mt-3">
                <summary class="cursor-pointer text-sm font-bold">PC boxes ({snap.boxes.reduce((n, b) => n + b.mons.length, 0)} Pokémon)</summary>
                {#each snap.boxes.filter((b) => b.mons.length) as box}
                  <p class="mt-2 text-xs font-bold">Box {box.box}</p>
                  <div class="flex flex-wrap gap-1">
                    {#each box.mons as mon}
                      <span class="inline-flex items-center gap-x-1 rounded border border-gray-300 px-1 text-xs dark:border-gray-600" title="Lv {mon.level}">
                        <MonIcon speciesId={mon.species.id} shiny={mon.shiny} />{mon.nickname} · Lv {mon.level}
                      </span>
                    {/each}
                  </div>
                {/each}
              </details>
            {/if}
          {:else}<p class="nz-muted">No Unbound save was accepted during this attempt.</p>{/if}
        </section>

        <section aria-labelledby="notes">
          <h2 id="notes" class="mb-2 text-lg font-bold">Attempt notes</h2>
          {#if data.attempt.notes}<p class="whitespace-pre-line text-sm">{data.attempt.notes}</p>{:else}<p class="nz-muted">No attempt notes.</p>{/if}
          {#if done.length}
            <h3 class="mt-3 mb-1 text-sm font-bold">Checklist completed ({done.length})</h3>
            <ul class="list-inside list-disc text-sm">
              {#each done as [itemId, v]}<li>{checklistNames[itemId] || '(deleted checklist item)'} <span class="opacity-60">{fmtDate(v.at)}</span></li>{/each}
            </ul>
          {/if}
        </section>

        <section aria-labelledby="lessons">
          <h2 id="lessons" class="mb-2 text-lg font-bold">Lessons from this attempt ({lessons.length})</h2>
          {#each lessons as l (l.id)}<p class="nz-card mb-2 whitespace-pre-line text-sm">{l.text}</p>{:else}<p class="nz-muted">No lessons linked to this attempt yet.</p>{/each}
        </section>
      {/if}

      <section class="mt-6 border-t-2 border-gray-200 pt-4 dark:border-gray-700">
        {#if !showDelete}
          <button class="nz-btn danger" on:click={() => (showDelete = true)}>Delete this archived attempt…</button>
        {:else}
          <div class="flex flex-col gap-y-3 rounded-xl border-2 border-red-500 p-3">
            <p class="text-sm"><b>This permanently deletes the archived attempt</b> and everything recorded in it. It cannot be undone. Your other attempts and notes are not affected.</p>
            <label class="flex items-start gap-x-2 text-sm">
              <input type="checkbox" class="mt-1 h-5 w-5" bind:checked={deleteConfirmed} data-testid="delete-confirm" />
              I understand this cannot be undone.
            </label>
            <div class="flex flex-wrap gap-2">
              <button class="nz-btn danger solid" disabled={!deleteConfirmed} on:click={remove} data-testid="delete-archive">Delete permanently</button>
              <button class="nz-btn" on:click={() => ((showDelete = false), (deleteConfirmed = false))}>Keep it</button>
            </div>
          </div>
        {/if}
      </section>
    {/if}
  </main>
</div>
