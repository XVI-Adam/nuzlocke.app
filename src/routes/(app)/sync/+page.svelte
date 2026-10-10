<script>
  import { onMount } from 'svelte'
  import { fade } from 'svelte/transition'

  import { readdata } from '$lib/store'
  import { Button } from '$lib/components/core'
  import { readBaseline, acceptBaseline } from '$lib/unbound/baseline'
  import { diffSnapshots, DIFF_STATUS, DEFAULT_GRAVEYARD_BOX } from '$lib/unbound/diff'

  import Preview from './Preview.svelte'
  import Changes from './Changes.svelte'
  import DropboxFetch from './DropboxFetch.svelte'

  const graveyardBox = DEFAULT_GRAVEYARD_BOX

  let runId, run, baseline
  onMount(() => {
    const [, , id, save] = readdata()
    runId = id
    run = save
    baseline = readBaseline(id)
  })

  $: isUnbound = Boolean(run?.game?.startsWith('unbound'))
  $: capProfile = run?.game === 'unbound_exp' ? 'expert' : 'normal'

  // The snapshot under review, and the baseline it was compared against
  let snapshot = null,
    source = null,
    comparedTo = null,
    diff = null
  let loading = false,
    error = null,
    accepted = false

  const review = async (bytes, from) => {
    loading = true
    error = snapshot = diff = null
    accepted = false
    try {
      // Loaded on demand: the parser and its data tables are ~290KB
      const { parseUnboundSave } = await import('$lib/unbound/parse')
      snapshot = parseUnboundSave(bytes)
      source = from
      comparedTo = baseline
      diff = diffSnapshots(comparedTo?.snapshot, snapshot, { graveyardBox })
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
    if (CONFIRM[diff.status] && !window.confirm(CONFIRM[diff.status])) return
    baseline = acceptBaseline(runId, snapshot, source)
    accepted = true
  }

  const discard = () => {
    snapshot = diff = error = null
    accepted = false
  }
</script>

<svelte:head>
  <title>Nuzlocke Tracker | Sync save</title>
</svelte:head>

<div class="container mx-auto pb-24" in:fade={{ duration: 250 }}>
  <main class="p-container flex flex-col gap-y-6 pt-20 md:pt-24">
    <header>
      <h1 class="text-2xl font-bold">Sync save</h1>
      <p class="text-sm opacity-75">
        Load your Pokémon Unbound save to preview it. Nothing in your tracker changes; accepting a
        save only stores it as the comparison point for your next sync.
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
      <Preview {snapshot} {capProfile} {graveyardBox} />
      <hr />
      <Changes {diff} baseline={comparedTo} {graveyardBox} />

      <div class="flex flex-wrap items-center gap-3">
        {#if accepted}
          <p class="text-sm" role="status" data-testid="save-accepted">
            ✓ Accepted save #{snapshot.game.saveIndex} as the comparison point for your next sync.
          </p>
        {:else}
          <Button rounded solid disabled={!isUnbound || !runId} on:click={accept}>
            Accept as last sync
          </Button>
          <Button rounded on:click={discard}>Discard</Button>
          <span class="text-xs opacity-60">Your tracker stays unchanged either way.</span>
        {/if}
      </div>
    {/if}
  </main>
</div>
