<script>
  import { onMount } from 'svelte'
  import { fade } from 'svelte/transition'

  import { readdata, getGameStore } from '$lib/store'
  import { Button } from '$lib/components/core'
  import { fetchData } from '$utils/fetchers'
  import { normalise } from '$utils/string'
  import { readSide, writeSide } from '$lib/unbound/baseline'
  import { diffSnapshots, DIFF_STATUS, DEFAULT_GRAVEYARD_BOX } from '$lib/unbound/diff'
  import { planReconciliation, applyReconciliation } from '$lib/unbound/reconcile'
  import { isWritableRun } from '$lib/history/archive'

  import Preview from './Preview.svelte'
  import Changes from './Changes.svelte'
  import Reconcile from './Reconcile.svelte'
  import DropboxFetch from './DropboxFetch.svelte'

  const graveyardBox = DEFAULT_GRAVEYARD_BOX

  let runId, run, baseline
  onMount(() => {
    const [, , id, save] = readdata()
    runId = id
    run = save
    baseline = readSide(id).baseline
  })

  $: isUnbound = Boolean(run?.game?.startsWith('unbound'))

  // The snapshot under review, and the baseline it was compared against
  let snapshot = null,
    source = null,
    comparedTo = null,
    diff = null
  let loading = false,
    error = null,
    accepted = null

  // Tracker reconciliation (Unbound runs only)
  let tracker = null,
    lookup = null,
    choices = {}
  const plans = (choices) => {
    if (!snapshot || !tracker || !lookup) return [null, null]
    const side = readSide(runId)
    return [
      planReconciliation({ snapshot, tracker, side, lookup, graveyardBox }),
      planReconciliation({ snapshot, tracker, side, lookup, choices, graveyardBox })
    ]
  }
  $: [basePlan, plan] = plans(choices, snapshot, tracker, lookup)

  const review = async (bytes, from) => {
    loading = true
    error = snapshot = diff = null
    accepted = null
    choices = {}
    try {
      // Loaded on demand: the parser and its data tables are ~290KB
      const { parseUnboundSave } = await import('$lib/unbound/parse')
      snapshot = parseUnboundSave(bytes)
      source = from
      comparedTo = baseline
      diff = diffSnapshots(comparedTo?.snapshot, snapshot, { graveyardBox })
      if (isUnbound && runId) {
        // The tracker's own Pokémon data, as used for dupe checks
        const data = await fetchData()
        lookup = (alias) => alias && data?.aliasMap[normalise(alias)]
        tracker = readdata()[0] || {}
      }
    } catch (e) {
      console.error(e)
      error = e?.name === 'UnboundSaveError' ? e.message : 'Could not read this file.'
    } finally {
      loading = false
    }
  }

  const onfile = async (e) => {
    const input = e.currentTarget
    const file = input.files?.[0]
    if (!file) return
    await review(await file.arrayBuffer(), 'upload')
    input.value = ''
  }

  const CONFIRM = {
    [DIFF_STATUS.DIFFERENT_TRAINER]:
      'This save is from a different trainer than your last sync. Use it as the new comparison point?',
    [DIFF_STATUS.OLDER_SAVE]:
      'This save is older than your last sync. Use it as the comparison point anyway?'
  }

  const accept = () => {
    if (!isWritableRun(localStorage, runId)) {
      error = 'This attempt is no longer the active run (it may have been archived). Reload the page before syncing.'
      return
    }
    if (CONFIRM[diff.status] && !window.confirm(CONFIRM[diff.status])) return

    // One tracker write, planned against the latest stored data
    let result
    getGameStore(runId).update((raw) => {
      const current = JSON.parse(raw || '{}')
      const side = readSide(runId)
      const final = planReconciliation({ snapshot, tracker: current, side, lookup, choices, graveyardBox })
      result = { plan: final, ...applyReconciliation({ tracker: current, side, plan: final, snapshot, source, acceptedAt: Date.now() }) }
      return result.changed ? JSON.stringify(result.tracker) : raw
    })
    writeSide(runId, result.side)

    baseline = result.side.baseline
    tracker = result.tracker
    accepted = {
      updates: result.plan.updates.length,
      links: result.plan.autoLinks.length,
      team: result.plan.team.status === 'changed'
    }
  }

  const discard = () => {
    snapshot = diff = error = null
    accepted = null
    choices = {}
  }
</script>

<svelte:head>
  <title>Nuzlocke Tracker | Sync save</title>
</svelte:head>

<div class="nz-page container mx-auto pb-24" in:fade={{ duration: 250 }}>
  <main class="p-container flex flex-col gap-y-6 pt-20 md:pt-24">
    <header>
      <h1 class="text-2xl font-bold">Sync save</h1>
      <p class="text-sm opacity-75">
        Load your Pokémon Unbound save to preview it. Accepting updates the game facts of Pokémon
        linked to your tracker (species, nickname, nature, active team) and stores the save for your
        next comparison. Encounters, statuses and deaths are never changed.
      </p>
    </header>

    {#if run && !isUnbound}
      <p class="rounded-lg border-2 border-yellow-500 px-3 py-2 text-sm" role="alert">
        The active run is not a Pokémon Unbound run. You can preview a save, but not accept it.
      </p>
    {/if}

    <DropboxFetch disabled={loading} on:save={(e) => review(e.detail, 'dropbox')} />

    <div class="flex flex-wrap items-center gap-3">
      <span class="text-sm opacity-60">or</span>
      <label
        class="inline-flex h-10 cursor-pointer items-center rounded-lg border-2 px-4 text-sm hover:border-orange-500"
        class:opacity-50={loading}
      >
        Choose .sav file
        <input class="sr-only" type="file" accept=".sav,.srm,application/octet-stream" disabled={loading} on:change={onfile} data-testid="save-file" />
      </label>
      {#if loading}<span class="text-sm opacity-75">Reading save…</span>{/if}
    </div>

    {#if error}
      <p class="rounded-lg border-2 border-red-500 px-3 py-2 text-sm" role="alert" data-testid="save-error">{error}</p>
    {/if}

    {#if snapshot}
      <Preview {snapshot} {graveyardBox} />
      <hr />
      <Changes {diff} baseline={comparedTo} {graveyardBox} />

      {#if plan && !accepted}
        <hr />
        <Reconcile base={basePlan} {plan} {tracker} {graveyardBox} bind:choices />
      {/if}

      <div class="flex flex-wrap items-center gap-3">
        {#if accepted}
          <p class="text-sm" role="status" data-testid="save-accepted">
            ✓ Accepted save #{snapshot.game.saveIndex}: {accepted.updates} record{accepted.updates === 1 ? '' : 's'} updated,
            {accepted.links} new link{accepted.links === 1 ? '' : 's'}{accepted.team ? ', active team synced' : ''}.
          </p>
        {:else}
          <Button rounded solid disabled={!isUnbound || !runId || (isUnbound && !plan)} on:click={accept}>
            Accept save
          </Button>
          <Button rounded on:click={discard}>Discard</Button>
          <span class="text-xs opacity-60">Discarding changes nothing.</span>
        {/if}
      </div>
    {/if}
  </main>
</div>
