<script>
  // Replaces the old in-place reset: archive the current attempt (or
  // explicitly discard it), then start a new run with a new id.
  import { onMount } from 'svelte'
  import { uuid } from '$lib/utils/uuid'
  import { KEYS } from '$lib/history/storage'
  import { parseSaves } from '$lib/history/saves'
  import { readRun, summarizeAttempt, archiveAndStartNew, discardAndStartNew, STATUSES, STATUS_LABELS } from '$lib/history/archive'

  import Styles from '$c/History/Styles.svelte'
  import Stats from '$c/History/Stats.svelte'
  import { fmtDate } from '$c/History/format'

  let run, stats, loadError
  let title = '',
    status = 'archived',
    summary = ''
  let busy = false,
    error = null,
    showDiscard = false,
    discardConfirmed = false

  onMount(() => {
    const id = localStorage.getItem(KEYS.active)
    run = parseSaves(localStorage.getItem(KEYS.saves))[id]
    if (!run) return (loadError = 'There is no active run to start over.')
    title = `${run.name} – attempt ${+run.attempts || 1}`
    try {
      stats = summarizeAttempt(readRun(localStorage, run.id))
    } catch (e) {
      loadError = e.message
    }
  })

  // A full page load, so nothing in memory still points at the old run
  const finish = () => (window.location = '/game')

  const archive = () => {
    busy = true
    error = null
    try {
      archiveAndStartNew(localStorage, { runId: run.id, newRunId: uuid(), title, status, summary, now: Date.now() })
      finish()
    } catch (e) {
      console.error(e)
      error = e.message
      busy = false
    }
  }

  const discard = () => {
    if (!discardConfirmed) return
    busy = true
    error = null
    try {
      discardAndStartNew(localStorage, { runId: run.id, newRunId: uuid(), now: Date.now() })
      finish()
    } catch (e) {
      console.error(e)
      error = e.message
      busy = false
    }
  }
</script>

<svelte:head>
  <title>Nuzlocke Tracker | New attempt</title>
</svelte:head>

<Styles />

<div class="nz-page container mx-auto pb-24">
  <main class="p-container flex max-w-2xl flex-col gap-y-6 pt-20 md:pt-24">
    <header>
      <h1 class="text-2xl font-bold">Start a new attempt</h1>
      <p class="text-sm opacity-75">
        Your current attempt is archived first, so you can review it later. The new attempt gets a fresh tracker and its own
        save sync. Your route, boss and checklist notes carry over; checklist ticks start fresh.
      </p>
    </header>

    {#if !run}
      <p class="nz-alert" role="alert">{loadError || 'Loading…'}</p>
      <a class="nz-btn w-fit" href="/saves">Back to saves</a>
    {:else}
      <section class="nz-card flex flex-col gap-y-2" aria-labelledby="current">
        <h2 id="current" class="text-lg font-bold">
          {run.name} <span class="text-sm font-normal opacity-60">· attempt {+run.attempts || 1} · {run.game}</span>
        </h2>
        <p class="nz-muted">Started {fmtDate(run.created)} · last played {fmtDate(run.updated || run.created)}</p>
        {#if loadError}
          <p class="nz-alert" role="alert">{loadError}</p>
        {:else}
          <Stats {stats} />
        {/if}
      </section>

      <section class="flex flex-col gap-y-3" aria-label="Archive details">
        <label class="nz-label">
          Name for this attempt
          <input class="nz-input" bind:value={title} maxlength="200" data-testid="archive-title" />
        </label>
        <fieldset class="flex flex-col gap-y-1">
          <legend class="text-sm font-medium">How did it end?</legend>
          <div class="flex flex-wrap gap-2">
            {#each STATUSES as s}
              <label class="nz-btn cursor-pointer" class:primary={status === s}>
                <input class="sr-only" type="radio" bind:group={status} value={s} />
                {STATUS_LABELS[s]}
              </label>
            {/each}
          </div>
          <p class="nz-muted">“Archived” means you’d rather not say. Nothing is decided from save data.</p>
        </fieldset>
        <label class="nz-label">
          Summary or lessons (optional)
          <textarea class="nz-input" bind:value={summary} maxlength="4000" placeholder="e.g. Lost Boo and Rocky to the Rival’s crit" />
        </label>
      </section>

      {#if error}<p class="nz-alert" role="alert" data-testid="archive-error">{error}</p>{/if}

      <div class="flex flex-wrap gap-3">
        <button class="nz-btn primary" disabled={busy || !!loadError} on:click={archive} data-testid="archive-start">
          Archive & start new attempt
        </button>
        <a class="nz-btn" href="/game" data-testid="archive-cancel">Cancel</a>
      </div>

      <section class="mt-6 border-t-2 border-gray-200 pt-4 dark:border-gray-700">
        {#if !showDiscard}
          <button class="nz-btn danger" on:click={() => (showDiscard = true)}>Discard instead…</button>
        {:else}
          <div class="flex flex-col gap-y-3 rounded-xl border-2 border-red-500 p-3" role="group" aria-label="Discard attempt">
            <p class="text-sm">
              <b>Discarding permanently deletes this attempt</b> – its encounters, deaths, team, boss history, notes and Unbound
              save data. It will not appear in your history and cannot be recovered.
            </p>
            <label class="flex items-start gap-x-2 text-sm">
              <input type="checkbox" class="mt-1 h-5 w-5" bind:checked={discardConfirmed} data-testid="discard-confirm" />
              I understand that “{run.name}” attempt {+run.attempts || 1} will be deleted for good.
            </label>
            <div class="flex flex-wrap gap-3">
              <button class="nz-btn danger solid" disabled={!discardConfirmed || busy} on:click={discard} data-testid="discard-start">
                Delete it & start new attempt
              </button>
              <button class="nz-btn" on:click={() => ((showDiscard = false), (discardConfirmed = false))}>Keep it</button>
            </div>
          </div>
        {/if}
      </section>
    {/if}
  </main>
</div>
