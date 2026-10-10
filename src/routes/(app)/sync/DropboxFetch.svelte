<script>
  // Fetches the latest save via POST /api/unbound/save. The sync key is
  // stored only in this browser and sent as a bearer token, never in a URL.
  import { createEventDispatcher, onMount } from 'svelte'
  import { Button } from '$lib/components/core'

  export let disabled = false

  const STORAGE_KEY = 'nuzlocke.unbound.syncKey'
  const dispatch = createEventDispatcher()

  const MESSAGES = {
    unauthorized: 'Sync key was rejected. Enter it again.',
    'not-configured': "Dropbox sync isn't set up on this deployment yet.",
    misconfigured: 'The Dropbox link configured on the server is not a valid shared-file link.',
    'link-not-found': 'Dropbox says the shared link no longer exists.',
    timeout: 'Dropbox took too long to respond. Try again.',
    'not-a-file': 'Dropbox returned a web page instead of the save file. Check the shared link.'
  }

  let key = '',
    keyInput = '',
    fetching = false,
    error = null

  const store = {
    get: () => {
      try {
        return localStorage.getItem(STORAGE_KEY) || ''
      } catch {
        return ''
      }
    },
    set: (v) => {
      try {
        v ? localStorage.setItem(STORAGE_KEY, v) : localStorage.removeItem(STORAGE_KEY)
      } catch {
        /* storage unavailable: key lasts for this page only */
      }
    }
  }

  onMount(() => (key = store.get()))

  const saveKey = () => {
    key = keyInput.trim()
    keyInput = ''
    store.set(key)
    error = null
  }

  const forgetKey = () => {
    key = ''
    store.set('')
  }

  const fetchSave = async () => {
    fetching = true
    error = null
    try {
      const res = await fetch('/api/unbound/save', {
        method: 'POST',
        headers: { authorization: `Bearer ${key}` },
        cache: 'no-store'
      })
      if (!res.ok) {
        const code = (await res.json().catch(() => ({}))).error || `http-${res.status}`
        if (code === 'unauthorized') forgetKey()
        error = MESSAGES[code] || `Couldn't fetch the save from Dropbox (${code}).`
        return
      }
      dispatch('save', await res.arrayBuffer())
    } catch (e) {
      console.error(e)
      error = "Couldn't reach the server. Check your connection."
    } finally {
      fetching = false
    }
  }
</script>

<div class="flex flex-col gap-2" data-testid="dropbox-fetch">
  {#if key}
    <div class="flex flex-wrap items-center gap-3">
      <Button rounded solid disabled={disabled || fetching} on:click={fetchSave}>
        {fetching ? 'Fetching from Dropbox…' : 'Fetch latest from Dropbox'}
      </Button>
      <button class="text-xs underline opacity-60" on:click={forgetKey}>Forget sync key on this device</button>
    </div>
  {:else}
    <form class="flex flex-wrap items-center gap-2" on:submit|preventDefault={saveKey}>
      <label class="text-sm" for="sync-key">Sync key</label>
      <input
        id="sync-key"
        class="h-10 w-64 rounded-lg border-2 bg-transparent px-3 text-sm"
        type="password"
        autocomplete="off"
        spellcheck="false"
        placeholder="UNBOUND_SYNC_KEY from Vercel"
        bind:value={keyInput}
      />
      <Button rounded disabled={keyInput.trim().length < 32}>Save key</Button>
    </form>
    <p class="text-xs opacity-60">Needed once per device to fetch your save from Dropbox. It's stored only in this browser.</p>
  {/if}

  {#if error}
    <p class="rounded-lg border-2 border-red-500 px-3 py-2 text-sm" role="alert" data-testid="dropbox-error">{error}</p>
  {/if}
</div>
