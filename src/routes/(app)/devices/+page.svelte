<script>
  // Cross-device sync: connect this device, review what the first sync will
  // do, resolve conflicts, pair or revoke devices. See $lib/sync/engine.
  import { onMount } from 'svelte'
  import Styles from '$c/History/Styles.svelte'
  import { fmtDate } from '$c/History/format'
  import { syncStatus, STATE_LABELS } from '$lib/sync/status'
  import { loadState } from '$lib/sync/state'
  import { readLocal } from '$lib/sync/items'
  import { describeConflict } from '$lib/sync/engine'
  import { createApi } from '$lib/sync/api'
  import { beginConnect, provideRecoveryKey, previewConnect, completeConnect, disconnect, createPairingCode, recoveryKeyFor } from '$lib/sync/device'
  import { start, syncNow } from '$lib/sync/client'

  let st = loadState(localStorage)
  const refresh = () => (st = loadState(localStorage))
  $: config = st.config
  $: phase = !config ? 'setup' : config.stopped ? 'stopped' : config.connected ? 'connected' : !config.key ? 'needs-key' : 'preview'

  let busy = false,
    error = null,
    notice = null

  const run = async (fn) => {
    busy = true
    error = null
    notice = null
    try {
      await fn()
    } catch (e) {
      console.error('[devices]', e?.code || e?.name)
      error = e?.message || 'Something went wrong.'
    } finally {
      busy = false
      refresh()
    }
  }

  // ---- Setup
  const guessName = () => (/iPhone/.test(navigator.userAgent) ? 'iPhone' : /iPad/.test(navigator.userAgent) ? 'iPad' : /Android/.test(navigator.userAgent) ? 'Phone' : 'Computer')
  let method = 'pairing',
    name = guessName(),
    pairingCode = '',
    setupKey = '',
    hasExisting = false,
    recoveryKey = ''

  const connect = () =>
    run(async () => {
      const res = await beginConnect(localStorage, { method, name, pairingCode, setupKey, recoveryKey: method === 'setup' && hasExisting ? recoveryKey : '' })
      pairingCode = setupKey = recoveryKey = ''
      if (res.needsKey) notice = 'Sync is already set up on another device. Enter its recovery key to continue.'
    })

  const giveKey = () =>
    run(async () => {
      await provideRecoveryKey(localStorage, recoveryKey)
      recoveryKey = ''
    })

  const cancel = () =>
    run(async () => {
      await disconnect(localStorage)
      preview = null
      notice = 'Nothing was changed on this device.'
    })

  // ---- First-sync preview
  let preview = null,
    decisions = {},
    loadingPreview = false,
    newRecoveryKey = null
  $: if (phase === 'preview' && !preview && !loadingPreview && !error) loadPreview()

  async function loadPreview() {
    loadingPreview = true
    await run(async () => {
      preview = await previewConnect(localStorage)
      decisions = {}
    })
    loadingPreview = false
  }

  const confirm = () =>
    run(async () => {
      const wasNew = !!loadState(localStorage).config?.newDataset
      await completeConnect(localStorage, decisions)
      preview = null
      if (wasNew) newRecoveryKey = await recoveryKeyFor(localStorage)
      notice = 'This device is connected. Changes now sync automatically.'
      start()
      await syncNow()
      loadDevices()
    })

  // ---- Connected
  let devices = null,
    pairing = null,
    shownKey = null,
    now = Date.now()
  const api = () => createApi({ token: loadState(localStorage).config.token })

  const loadDevices = async () => {
    try {
      devices = (await api().devices()).devices
    } catch (e) {
      devices = null
    }
  }

  const syncNowClick = () => run(() => syncNow())
  const resolve = (id, choice) => run(() => syncNow({ decisions: { [id]: choice } }))
  const makePairing = () => run(async () => (pairing = await createPairingCode(localStorage)))
  const showKey = () => run(async () => (shownKey = await recoveryKeyFor(localStorage)))
  const copy = async (text) => {
    try {
      await navigator.clipboard.writeText(text)
      notice = 'Copied.'
    } catch {
      notice = 'Select the text and copy it manually.'
    }
  }

  const revoke = (d) => {
    if (!window.confirm(d.current ? 'Disconnect this device? Its data stays here; it just stops syncing.' : `Revoke “${d.name}”? It stops syncing immediately and keeps whatever data it has.`)) return
    run(async () => {
      if (d.current) await disconnect(localStorage)
      else await api().revoke(d.id)
      await loadDevices()
      notice = d.current ? 'This device was disconnected. Its data is still here.' : `“${d.name}” was revoked.`
    })
  }

  const disconnectHere = () => {
    if (!window.confirm('Disconnect this device? Its data stays here; it just stops syncing.')) return
    run(async () => {
      await disconnect(localStorage)
      notice = 'This device was disconnected. Its data is still here.'
    })
  }

  let resetKey = '',
    resetConfirm = ''
  const reset = () => {
    if (resetConfirm !== 'RESET') return
    run(async () => {
      await createApi().reset({ setupKey: resetKey, confirm: 'RESET' })
      resetKey = resetConfirm = ''
      await disconnect(localStorage, { revoke: false })
      notice = 'The synced copy was erased and every device disconnected. Data on each device is untouched. Set this device up again as the first device.'
    })
  }

  // ---- Conflicts
  $: local = st.conflicts.length ? readLocal(localStorage) : null
  $: conflicts = local ? st.conflicts.map((c) => describeConflict(c, local)) : []

  const KIND = { run: 'Active run', attempt: 'Attempt notes & checklist', archive: 'Archived attempt', archmeta: 'Archived attempt details', meta: 'Encryption check' }
  const SECTION = { routes: 'Route note', bosses: 'Boss note', objectives: 'Checklist item', lessons: 'Lesson' }
  const kindLabel = (i) => (i.kind === 'note' ? SECTION[i.section] : KIND[i.kind])
  const REASON = {
    'both-changed': 'Changed on this device and on another device since they last synced.',
    'archived-elsewhere': 'Archived on another device, but this device has changes to it that weren’t synced yet.',
    archived: 'Edited on another device after it was archived here.',
    'archive-differs': 'Archived separately on two devices with different data. Archived attempts are never overwritten.',
    invalid: 'The synced copy couldn’t be read (it may come from a newer version of the app).'
  }
  const choiceLabel = (c, choice) => {
    if (choice === 'copy') return c.kind === 'archive' ? 'Keep both (this device’s as a copy)' : c.here ? 'Keep my changes as a new run' : 'Keep the other device’s version as a new run'
    if (choice === 'local') return c.here ? 'Keep this device’s version' : 'Keep it deleted'
    return c.there ? 'Use the other device’s version' : 'Delete it here too'
  }
  const facts = (f) =>
    f
      ? [
          f.updated && `last played ${fmtDate(f.updated)}`,
          f.attempts && `attempt ${f.attempts}`,
          f.encounters !== undefined && `${f.encounters} encounters`,
          f.deaths !== undefined && `${f.deaths} deaths`,
          f.updatedAt && `edited ${fmtDate(f.updatedAt, 'D MMM YYYY HH:mm')}`,
          f.checked !== undefined && `${f.checked} ticked`,
          f.hasNotes && 'has notes'
        ]
          .filter(Boolean)
          .join(' · ') || 'present'
      : 'deleted'

  const groupCount = (list) =>
    Object.entries(list.reduce((acc, i) => ({ ...acc, [kindLabel(i)]: (acc[kindLabel(i)] || 0) + 1 }), {}))
      .map(([k, n]) => `${n} ${k.toLowerCase()}${n === 1 ? '' : 's'}`)
      .join(', ')

  onMount(() => {
    if (phase === 'connected') loadDevices()
    const t = setInterval(() => (now = Date.now()), 15000)
    const onSynced = () => refresh()
    window.addEventListener('nuzlocke:synced', onSynced)
    const unsub = syncStatus.subscribe(() => refresh())
    return () => {
      clearInterval(t)
      window.removeEventListener('nuzlocke:synced', onSynced)
      unsub()
    }
  })
</script>

<svelte:head>
  <title>Nuzlocke Tracker | Device sync</title>
</svelte:head>

<Styles />

<div class="nz-page container mx-auto pb-24">
  <main class="p-container flex max-w-3xl flex-col gap-y-6 pt-20 md:pt-24">
    <header class="flex flex-col gap-y-1">
      <h1 class="text-2xl font-bold">Device sync</h1>
      <p class="text-sm opacity-75">
        Keep your runs, archived attempts, notes and checklists the same on your computer and phone. Everything is encrypted on
        this device before it’s uploaded; the server only stores data it can’t read. Theme and the Unbound sync key stay on each
        device.
      </p>
    </header>

    {#if error}<p class="nz-alert" role="alert" data-testid="devices-error">{error}</p>{/if}
    {#if notice}<p class="nz-ok" role="status" data-testid="devices-notice">{notice}</p>{/if}

    {#if newRecoveryKey}
      <section class="nz-card flex flex-col gap-y-2 border-orange-500" aria-labelledby="rk-new">
        <h2 id="rk-new" class="text-lg font-bold">Save your recovery key</h2>
        <p class="text-sm">
          This key decrypts your synced data. Store it in a password manager. If you lose every connected device <b>and</b> this
          key, the synced copy can’t be recovered (your backups still can).
        </p>
        <code class="break-all rounded-lg bg-gray-100 p-2 text-sm dark:bg-gray-800" data-testid="recovery-key">{newRecoveryKey}</code>
        <div class="flex gap-2">
          <button class="nz-btn" on:click={() => copy(newRecoveryKey)}>Copy</button>
          <button class="nz-btn primary" on:click={() => (newRecoveryKey = null)}>I’ve saved it</button>
        </div>
      </section>
    {/if}

    {#if phase === 'setup'}
      <section class="nz-card flex flex-col gap-y-4" aria-labelledby="setup">
        <h2 id="setup" class="text-lg font-bold">Connect this device</h2>
        <fieldset class="flex flex-col gap-y-2 text-sm">
          <legend class="mb-1 font-medium">How?</legend>
          <label class="flex items-start gap-x-2"
            ><input type="radio" class="mt-0.5 h-5 w-5" bind:group={method} value="pairing" />
            <span>With a pairing code from a device that’s already connected</span></label
          >
          <label class="flex items-start gap-x-2"
            ><input type="radio" class="mt-0.5 h-5 w-5" bind:group={method} value="setup" />
            <span>With the setup key (first device, or no other device at hand)</span></label
          >
        </fieldset>

        <form class="flex flex-col gap-y-3" on:submit|preventDefault={connect} autocomplete="off">
          <label class="nz-label"
            >Name for this device
            <input class="nz-input" bind:value={name} maxlength="40" required data-testid="device-name" />
          </label>
          {#if method === 'pairing'}
            <label class="nz-label"
              >Pairing code
              <textarea class="nz-input font-mono" bind:value={pairingCode} rows="3" spellcheck="false" autocapitalize="off" required data-testid="pairing-code" />
              <span class="nz-muted font-normal">On the connected device: Device sync → Add another device.</span>
            </label>
          {:else}
            <label class="nz-label"
              >Setup key
              <input class="nz-input font-mono" type="password" bind:value={setupKey} autocomplete="off" required data-testid="setup-key" />
              <span class="nz-muted font-normal">The <code>SYNC_SETUP_KEY</code> value from your Vercel project settings.</span>
            </label>
            <label class="flex items-start gap-x-2 text-sm"
              ><input type="checkbox" class="mt-0.5 h-5 w-5" bind:checked={hasExisting} />
              <span>Sync is already set up on another device and I have the recovery key</span></label
            >
            {#if hasExisting}
              <label class="nz-label"
                >Recovery key
                <input class="nz-input font-mono" type="password" bind:value={recoveryKey} autocomplete="off" spellcheck="false" required data-testid="recovery-key-input" />
              </label>
            {/if}
          {/if}
          <p class="nz-muted">Nothing on this device changes yet: you’ll see what the first sync would do and confirm it first.</p>
          <button class="nz-btn primary w-fit" disabled={busy} data-testid="connect">Continue</button>
        </form>
      </section>
    {:else if phase === 'needs-key'}
      <section class="nz-card flex flex-col gap-y-3" aria-labelledby="nk">
        <h2 id="nk" class="text-lg font-bold">Enter the recovery key</h2>
        <form class="flex flex-col gap-y-3" on:submit|preventDefault={giveKey} autocomplete="off">
          <label class="nz-label"
            >Recovery key
            <input class="nz-input font-mono" type="password" bind:value={recoveryKey} autocomplete="off" spellcheck="false" required data-testid="recovery-key-input" />
            <span class="nz-muted font-normal">On a connected device: Device sync → Show recovery key. Or cancel and use a pairing code instead.</span>
          </label>
          <div class="flex gap-2">
            <button class="nz-btn primary" disabled={busy}>Continue</button>
            <button type="button" class="nz-btn" disabled={busy} on:click={cancel}>Cancel</button>
          </div>
        </form>
      </section>
    {:else if phase === 'preview'}
      <section class="nz-card flex flex-col gap-y-3" aria-labelledby="pv" data-testid="connect-preview">
        <h2 id="pv" class="text-lg font-bold">Review the first sync</h2>
        {#if !preview}
          <p class="nz-muted">{busy ? 'Comparing this device with the synced data…' : ''}</p>
          {#if error}<div class="flex gap-2"><button class="nz-btn" on:click={loadPreview}>Try again</button><button class="nz-btn" on:click={cancel}>Cancel</button></div>{/if}
        {:else}
          <ul class="flex flex-col gap-y-1 text-sm">
            <li data-testid="preview-download">
              <b>Download to this device:</b>
              {preview.download.length ? groupCount(preview.download) : 'nothing'}
            </li>
            <li data-testid="preview-upload"><b>Upload from this device:</b> {preview.upload.length ? groupCount(preview.upload) : 'nothing'}</li>
            <li><b>Already identical:</b> {preview.same}</li>
            <li data-testid="preview-conflicts"><b>Different on both:</b> {preview.conflicts.length}</li>
          </ul>
          {#if preview.download.length || preview.upload.length}
            <details class="text-sm">
              <summary class="cursor-pointer">Show items</summary>
              <ul class="mt-2 flex flex-col gap-y-0.5">
                {#each preview.download as i (i.id)}<li>↓ {kindLabel(i)}: {i.label}{i.deleted ? ' (delete)' : ''}</li>{/each}
                {#each preview.upload as i (i.id)}<li>↑ {kindLabel(i)}: {i.label}{i.deleted ? ' (delete)' : ''}</li>{/each}
              </ul>
            </details>
          {/if}
          {#if !preview.remoteInitialized}
            <p class="text-sm">This is the first device: a new encrypted dataset is created, and you’ll get a recovery key to save.</p>
          {/if}

          {#each preview.conflicts as c (c.id)}
            <fieldset class="rounded-lg border-2 border-yellow-500 p-3 text-sm" data-testid="preview-conflict">
              <legend class="px-1 font-medium">{kindLabel(c)}: {c.label}</legend>
              <p class="text-xs opacity-75">
                This device: {#if c.localLabel && c.localLabel !== c.remoteLabel}“{c.localLabel}” · {/if}{facts(c.localFacts)}<br />
                Synced copy: {#if c.remoteLabel && c.localLabel !== c.remoteLabel}“{c.remoteLabel}” · {/if}{facts(c.remoteFacts)}
              </p>
              <div class="mt-2 flex flex-wrap gap-2">
                <label class="nz-btn cursor-pointer" class:primary={!decisions[c.id]}>
                  <input class="sr-only" type="radio" name={c.id} checked={!decisions[c.id]} on:change={() => (decisions = { ...decisions, [c.id]: undefined })} />
                  Decide later
                </label>
                {#each c.choices as choice}
                  <label class="nz-btn cursor-pointer" class:primary={decisions[c.id] === choice}>
                    <input class="sr-only" type="radio" name={c.id} value={choice} checked={decisions[c.id] === choice} on:change={() => (decisions = { ...decisions, [c.id]: choice })} />
                    {choiceLabel(c, choice)}
                  </label>
                {/each}
              </div>
            </fieldset>
          {/each}

          <p class="nz-muted">Nothing on this device is deleted. Items you decide later stay as they are here and are listed on this page.</p>
          <div class="flex flex-wrap gap-2">
            <button class="nz-btn primary" disabled={busy} on:click={confirm} data-testid="confirm-connect">Connect and sync</button>
            <button class="nz-btn" disabled={busy} on:click={cancel} data-testid="cancel-connect">Cancel</button>
          </div>
        {/if}
      </section>
    {:else if phase === 'stopped'}
      <section class="nz-card flex flex-col gap-y-3" aria-labelledby="stopped">
        <h2 id="stopped" class="text-lg font-bold">Sync stopped</h2>
        <p class="text-sm">{config.stopped}</p>
        <p class="nz-muted">Your data on this device is untouched.</p>
        <button class="nz-btn primary w-fit" disabled={busy} on:click={() => run(() => disconnect(localStorage, { revoke: false }))}>Set up this device again</button>
      </section>
    {:else}
      <section class="nz-card flex flex-col gap-y-2" aria-labelledby="status" data-testid="sync-status">
        <h2 id="status" class="text-lg font-bold">Status: {STATE_LABELS[$syncStatus.state] || 'Connected'}</h2>
        {#if $syncStatus.message}<p class="text-sm">{$syncStatus.message}</p>{/if}
        <p class="nz-muted">
          “{config.deviceName}” · last synced {config.lastSyncedAt ? fmtDate(config.lastSyncedAt, 'D MMM YYYY HH:mm') : 'never'}
        </p>
        <button class="nz-btn primary w-fit" disabled={busy || $syncStatus.state === 'syncing'} on:click={syncNowClick} data-testid="sync-now">Sync now</button>
      </section>

      {#if conflicts.length}
        <section class="nz-card flex flex-col gap-y-3 border-yellow-500" aria-labelledby="cf">
          <h2 id="cf" class="text-lg font-bold">Needs your choice ({conflicts.length})</h2>
          <p class="text-sm opacity-75">These weren’t synced because they changed on more than one device. Everything else is in sync.</p>
          {#each conflicts as c (c.id)}
            <div class="rounded-lg border-2 border-yellow-500 p-3 text-sm" data-testid="conflict">
              <p class="font-medium">{kindLabel(c)}: {c.label}</p>
              <p class="text-xs opacity-75">{REASON[c.reason] || ''}</p>
              <p class="text-xs opacity-75">
                This device: {#if c.localLabel && c.localLabel !== c.remoteLabel}“{c.localLabel}” · {/if}{facts(c.localFacts)}<br />
                Other device: {#if c.remoteLabel && c.localLabel !== c.remoteLabel}“{c.remoteLabel}” · {/if}{facts(c.remoteFacts)}
              </p>
              <div class="mt-2 flex flex-wrap gap-2">
                {#each c.choices as choice}
                  <button class="nz-btn" disabled={busy} on:click={() => resolve(c.id, choice)} data-testid="resolve-{choice}">{choiceLabel(c, choice)}</button>
                {/each}
              </div>
            </div>
          {/each}
        </section>
      {/if}

      <section class="nz-card flex flex-col gap-y-3" aria-labelledby="add">
        <h2 id="add" class="text-lg font-bold">Add another device</h2>
        {#if pairing && pairing.expiresAt > now}
          <p class="text-sm">
            On the other device open Device sync, choose “pairing code” and enter this. It works once, for 15 minutes
            (until {fmtDate(pairing.expiresAt, 'HH:mm')}). It contains your encryption key: only enter it on your own devices.
          </p>
          <code class="break-all rounded-lg bg-gray-100 p-2 text-sm dark:bg-gray-800" data-testid="pairing-output">{pairing.code}</code>
          <div class="flex gap-2">
            <button class="nz-btn" on:click={() => copy(pairing.code)}>Copy</button>
            <button class="nz-btn" on:click={() => (pairing = null)}>Hide</button>
          </div>
        {:else}
          <button class="nz-btn w-fit" disabled={busy} on:click={makePairing} data-testid="make-pairing">Create a pairing code</button>
        {/if}
      </section>

      <section class="nz-card flex flex-col gap-y-3" aria-labelledby="devs">
        <h2 id="devs" class="text-lg font-bold">Connected devices</h2>
        {#if devices}
          <ul class="flex flex-col divide-y-2 divide-gray-100 text-sm dark:divide-gray-800">
            {#each devices as d (d.id)}
              <li class="flex flex-wrap items-center justify-between gap-2 py-2" data-testid="device-row">
                <span>
                  <b>{d.name}</b>{#if d.current} <span class="nz-chip nz-status-completed">this device</span>{/if}<br />
                  <span class="nz-muted">added {fmtDate(d.createdAt)} · last seen {fmtDate(d.lastSeen, 'D MMM HH:mm')}</span>
                </span>
                <button class="nz-btn danger" disabled={busy} on:click={() => revoke(d)}>{d.current ? 'Disconnect' : 'Revoke'}</button>
              </li>
            {/each}
          </ul>
        {:else}
          <button class="nz-btn w-fit" on:click={loadDevices}>Load devices</button>
        {/if}
      </section>

      <section class="nz-card flex flex-col gap-y-3" aria-labelledby="rk">
        <h2 id="rk" class="text-lg font-bold">Recovery key</h2>
        <p class="text-sm opacity-75">Lets a new device read the synced data with the setup key, if no connected device is at hand.</p>
        {#if shownKey}
          <code class="break-all rounded-lg bg-gray-100 p-2 text-sm dark:bg-gray-800">{shownKey}</code>
          <div class="flex gap-2"><button class="nz-btn" on:click={() => copy(shownKey)}>Copy</button><button class="nz-btn" on:click={() => (shownKey = null)}>Hide</button></div>
        {:else}
          <button class="nz-btn w-fit" on:click={showKey}>Show recovery key</button>
        {/if}
      </section>

      <section class="nz-card flex flex-col gap-y-3" aria-labelledby="dc">
        <h2 id="dc" class="text-lg font-bold">Disconnect</h2>
        <p class="text-sm opacity-75">Stops syncing on this device and revokes its access. Nothing is deleted here or elsewhere.</p>
        <button class="nz-btn danger w-fit" disabled={busy} on:click={disconnectHere} data-testid="disconnect">Disconnect this device</button>
      </section>
    {/if}

    {#if phase === 'connected' || phase === 'needs-key' || phase === 'stopped'}
      <section class="nz-card flex flex-col gap-y-2 text-sm" aria-labelledby="erase">
        <h2 id="erase" class="text-lg font-bold">No recovery key?</h2>
        <p class="opacity-75">
          Without the recovery key or a connected device, the synced copy can’t be decrypted by anyone – it can’t be
          recovered, only erased. Data on each device (and your backup files) is not affected.
        </p>
        <details>
          <summary class="cursor-pointer">Erase the synced copy…</summary>
          <form class="mt-2 flex flex-col gap-y-2" on:submit|preventDefault={reset} autocomplete="off">
            <p>
              Deletes everything stored on the server and disconnects every device. Data on each device stays. Afterwards,
              set up sync again from the device with the most complete data (it gets a new recovery key). Also use this if
              the recovery key was exposed.
            </p>
            <label class="nz-label">Setup key <input class="nz-input font-mono" type="password" bind:value={resetKey} required data-testid="reset-key" /></label>
            <label class="nz-label">Type RESET to confirm <input class="nz-input" bind:value={resetConfirm} required data-testid="reset-confirm" /></label>
            <button class="nz-btn danger solid w-fit" disabled={busy || resetConfirm !== 'RESET'} data-testid="reset">Erase synced copy</button>
          </form>
        </details>
      </section>
    {/if}

    <section class="nz-card flex flex-col gap-y-2 text-sm" aria-labelledby="help">
      <h2 id="help" class="text-lg font-bold">How it works</h2>
      <ul class="list-inside list-disc opacity-80">
        <li>Changes sync a few seconds after you make them, when the app opens or comes back, and with “Sync now”.</li>
        <li>Offline changes stay on this device and sync when you’re back online.</li>
        <li>If the same thing changed on two devices, nothing is overwritten: it’s listed here for you to choose.</li>
        <li>Deleted notes and attempts stay deleted when an older device reconnects.</li>
        <li>Archived attempts are never changed by sync; only their title, status and summary sync.</li>
        <li>The server sees how many items you have, their sizes and when they change, and your device names – not their contents.</li>
        <li>
          Backups are separate: keep using <a class="underline" href="/backup">Backup & restore</a>. To recover, restore a backup on a
          device (it never deletes anything), then let it sync.
        </li>
      </ul>
    </section>
  </main>
</div>
