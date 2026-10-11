<script>
  import { onMount } from 'svelte'
  import { KEYS } from '$lib/history/storage'
  import { parseSaves } from '$lib/history/saves'
  import { listArchives, readRun, summarizeAttempt, STATUS_LABELS } from '$lib/history/archive'

  import Styles from '$c/History/Styles.svelte'
  import Stats from '$c/History/Stats.svelte'
  import { fmtDate } from '$c/History/format'

  let archives = [],
    current = null,
    error = null,
    loaded = false,
    game = 'all'

  onMount(() => {
    try {
      archives = listArchives(localStorage)
    } catch (e) {
      error = e.message
    }
    const run = parseSaves(localStorage.getItem(KEYS.saves))[localStorage.getItem(KEYS.active)]
    if (run) {
      let stats = null
      try {
        stats = summarizeAttempt(readRun(localStorage, run.id))
      } catch (e) {
        console.error(e)
      }
      current = { run, stats }
    }
    loaded = true
  })

  $: games = [...new Set(archives.map((a) => a.meta.game).filter(Boolean))]
  $: shown = game === 'all' ? archives : archives.filter((a) => a.meta.game === game)
</script>

<svelte:head>
  <title>Nuzlocke Tracker | Attempt history</title>
</svelte:head>

<Styles />

<div class="nz-page container mx-auto pb-24">
  <main class="p-container flex max-w-3xl flex-col gap-y-6 pt-20 md:pt-24">
    <header class="flex flex-col gap-y-1">
      <h1 class="text-2xl font-bold">Attempt history</h1>
      <p class="text-sm opacity-75">Archived attempts are read-only records. Save sync never changes them.</p>
      <nav class="mt-2 flex flex-wrap gap-2 text-sm" aria-label="Related pages">
        <a class="nz-btn" href="/game">Current game</a>
        <a class="nz-btn" href="/notes">Notes</a>
        <a class="nz-btn" href="/backup">Backup & restore</a>
      </nav>
    </header>

    {#if error}<p class="nz-alert" role="alert">{error}</p>{/if}

    {#if current}
      <section class="nz-card flex flex-col gap-y-2" aria-labelledby="current-title">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <h2 id="current-title" class="text-lg font-bold">
            {current.run.name} <span class="text-sm font-normal opacity-60">· attempt {+current.run.attempts || 1} · in progress</span>
          </h2>
          <a class="nz-btn" href="/history/new-attempt" data-testid="new-attempt-link">Start new attempt…</a>
        </div>
        <p class="nz-muted">Started {fmtDate(current.run.created)} · last played {fmtDate(current.run.updated || current.run.created)}</p>
        <Stats stats={current.stats} />
      </section>
    {/if}

    <section class="flex flex-col gap-y-3" aria-labelledby="archived-title">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <h2 id="archived-title" class="text-lg font-bold">Archived attempts ({shown.length})</h2>
        {#if games.length > 1}
          <label class="flex items-center gap-x-2 text-sm">
            Game
            <select class="nz-input w-auto" bind:value={game}>
              <option value="all">All</option>
              {#each games as g}<option value={g}>{g}</option>{/each}
            </select>
          </label>
        {/if}
      </div>

      {#if loaded && !shown.length}
        <p class="nz-muted">
          No archived attempts yet. When you start a new attempt, the current one is archived here instead of being wiped.
        </p>
      {/if}

      {#each shown as { meta, stats, missing } (meta.id)}
        <a href="/history/{meta.id}" class="nz-card flex flex-col gap-y-2 transition hover:border-orange-400" data-testid="archive-card">
          <div class="flex flex-wrap items-center gap-2">
            <h3 class="text-base font-bold">{meta.title || meta.name || 'Untitled attempt'}</h3>
            <span class="nz-chip nz-status-{meta.status}">{STATUS_LABELS[meta.status]}</span>
          </div>
          <p class="nz-muted">
            {meta.name || 'Unknown run'} · attempt {meta.attemptNumber ?? 'unknown'} · {meta.game || 'unknown game'}<br />
            Started {fmtDate(meta.created)} · last played {fmtDate(meta.updated)} · archived {fmtDate(meta.archivedAt)}
          </p>
          <Stats stats={missing ? null : stats} />
          {#if meta.summary}<p class="line-clamp-3 whitespace-pre-line text-sm italic">{meta.summary}</p>{/if}
        </a>
      {/each}
    </section>
  </main>
</div>
