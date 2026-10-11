<script>
  // Download a full backup on one device and restore/merge it on another.
  // Everything stays local: the file only goes where you save or send it.
  import { onMount } from 'svelte'
  import { buildBackup, parseBackupText, planRestore, applyRestore } from '$lib/history/backup'
  import { KEYS } from '$lib/history/storage'
  import { fmtDate } from '$c/History/format'
  import Styles from '$c/History/Styles.svelte'

  let summary = null,
    skipped = [],
    downloadError = null
  let file = null,
    backup = null,
    warnings = [],
    plan = null,
    decisions = {},
    switchActive = false,
    restoreError = null,
    result = null,
    busy = false

  const describe = () => {
    const { backup: b, skipped: s } = buildBackup(localStorage, Date.now())
    summary = { runs: b.runs.length, archives: b.archives.length, notes: ['routes', 'bosses', 'objectives', 'lessons'].reduce((n, k) => n + b.knowledge[k].length, 0) }
    skipped = s
    return b
  }
  onMount(describe)

  const download = () => {
    downloadError = null
    try {
      const b = describe()
      const blob = new Blob([JSON.stringify(b)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `nuzlocke-backup-${fmtDate(b.exportedAt, 'YYYY-MM-DD-HHmm')}.json`
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 10000)
    } catch (e) {
      console.error(e)
      downloadError = 'Could not create the backup file.'
    }
  }

  const onfile = async (e) => {
    restoreError = result = backup = plan = null
    warnings = []
    decisions = {}
    file = e.currentTarget.files?.[0]
    if (!file) return
    try {
      const parsed = parseBackupText(await file.text())
      backup = parsed.backup
      warnings = parsed.warnings
      plan = planRestore(localStorage, backup)
      const active = localStorage.getItem(KEYS.active)
      switchActive = !!backup.active && (!active || active === backup.active)
    } catch (err) {
      console.error(err)
      restoreError = err.message
    }
  }

  const apply = () => {
    busy = true
    restoreError = null
    try {
      result = applyRestore(localStorage, backup, decisions, { switchActive })
      plan = planRestore(localStorage, backup)
    } catch (err) {
      console.error(err)
      restoreError = `${err.message} Nothing was changed.`
    } finally {
      busy = false
    }
  }

  const TYPE = { run: 'Active run', archive: 'Archived attempt', knowledge: 'Note' }
  const SECTION = { routes: 'Route note', bosses: 'Boss note', objectives: 'Checklist item', lessons: 'Lesson' }
  const kind = (i) => (i.type === 'knowledge' ? SECTION[i.section] : TYPE[i.type])
  const facts = (f) =>
    f
      ? [
          f.updated && `last played ${fmtDate(f.updated)}`,
          f.attempts && `attempt ${f.attempts}`,
          f.encounters !== undefined && `${f.encounters} encounters`,
          f.deaths !== undefined && `${f.deaths} deaths`,
          f.updatedAt && `edited ${fmtDate(f.updatedAt, 'D MMM YYYY HH:mm')}`
        ]
          .filter(Boolean)
          .join(' · ')
      : 'unreadable'

  $: conflicts = plan?.items.filter((i) => i.state === 'conflict') || []
  $: added = plan?.items.filter((i) => i.state === 'new') || []
  $: same = plan?.items.filter((i) => i.state === 'same') || []
  $: activeLabel = backup?.runs.find((r) => r.save.id === backup.active)?.save.name
</script>

<svelte:head>
  <title>Nuzlocke Tracker | Backup & restore</title>
</svelte:head>

<Styles />

<div class="nz-page container mx-auto pb-24">
  <main class="p-container flex max-w-3xl flex-col gap-y-6 pt-20 md:pt-24">
    <header class="flex flex-col gap-y-1">
      <h1 class="text-2xl font-bold">Backup & restore</h1>
      <p class="text-sm opacity-75">
        Move your runs between devices, or keep a safety copy. A backup contains every run, archived attempt, note and
        Unbound save state on this device (including Pokémon nicknames and trainer details from accepted saves). It never
        includes your sync key. Keep the file somewhere private.
      </p>
      <p class="text-sm opacity-75">
        On iPhone, Safari can clear site data for sites you haven’t opened in a while. Adding the app to your Home Screen
        and keeping a recent backup protects you.
      </p>
    </header>

    <section class="nz-card flex flex-col gap-y-3" aria-labelledby="dl">
      <h2 id="dl" class="text-lg font-bold">1. Download a backup</h2>
      {#if summary}
        <p class="text-sm">{summary.runs} run(s), {summary.archives} archived attempt(s), {summary.notes} note(s).</p>
      {/if}
      {#if skipped.length}
        <div class="nz-alert" role="alert">
          <p>These couldn’t be read and won’t be in the backup:</p>
          <ul class="list-inside list-disc">{#each skipped as s}<li>{s.label || s.id}: {s.reason}</li>{/each}</ul>
        </div>
      {/if}
      {#if downloadError}<p class="nz-alert" role="alert">{downloadError}</p>{/if}
      <button class="nz-btn primary w-fit" on:click={download} data-testid="backup-download">Download backup</button>
    </section>

    <section class="nz-card flex flex-col gap-y-3" aria-labelledby="rs">
      <h2 id="rs" class="text-lg font-bold">2. Restore or merge a backup</h2>
      <p class="text-sm opacity-75">
        Nothing changes until you press “Apply”. Items that differ on this device are listed so you can choose which copy
        to keep. Notes or attempts deleted on one device come back if they’re in the backup – skip them below.
      </p>
      <label class="nz-btn w-fit cursor-pointer">
        Choose backup file
        <input class="sr-only" type="file" accept=".json,application/json" on:change={onfile} data-testid="backup-file" />
      </label>

      {#if restoreError}<p class="nz-alert" role="alert" data-testid="restore-error">{restoreError}</p>{/if}
      {#if warnings.length}
        <div class="nz-alert" role="alert"><ul class="list-inside list-disc">{#each warnings as w}<li>{w}</li>{/each}</ul></div>
      {/if}

      {#if plan}
        <p class="text-sm">
          Backup from {fmtDate(backup.exportedAt, 'D MMM YYYY HH:mm')}: {added.length} new, {conflicts.length} different, {same.length} already identical.
        </p>

        {#if conflicts.length}
          <h3 class="font-bold">Different on this device ({conflicts.length})</h3>
          {#each conflicts as i (i.key)}
            <fieldset class="rounded-lg border-2 border-yellow-500 p-3 text-sm" data-testid="restore-conflict">
              <legend class="px-1 font-medium">{kind(i)}: {i.label}</legend>
              {#if i.note}<p class="mb-1">{i.note}</p>{/if}
              {#if i.type !== 'knowledge' || i.local}
                <p class="text-xs opacity-75">This device: {facts(i.local)}<br />Backup: {facts(i.incoming)}</p>
              {/if}
              <div class="mt-2 flex flex-wrap gap-2">
                {#each i.choices as c}
                  <label class="nz-btn cursor-pointer" class:primary={(decisions[i.key] || i.default) === c}>
                    <input class="sr-only" type="radio" name={i.key} value={c} checked={(decisions[i.key] || i.default) === c} on:change={() => (decisions = { ...decisions, [i.key]: c })} />
                    {c === 'keep' ? 'Keep this device’s copy' : 'Use the backup’s copy'}
                  </label>
                {/each}
              </div>
            </fieldset>
          {/each}
        {/if}

        {#if added.length}
          <h3 class="font-bold">New from the backup ({added.length})</h3>
          <ul class="flex flex-col gap-y-1 text-sm">
            {#each added as i (i.key)}
              <li>
                <label class="flex items-start gap-x-2">
                  <input
                    type="checkbox"
                    class="mt-0.5 h-5 w-5"
                    checked={(decisions[i.key] || i.default) === 'add'}
                    on:change={(e) => (decisions = { ...decisions, [i.key]: e.currentTarget.checked ? 'add' : 'skip' })}
                  />
                  <span>{kind(i)}: <b>{i.label}</b>{#if i.incoming}<span class="opacity-60"> · {facts(i.incoming)}</span>{/if}</span>
                </label>
              </li>
            {/each}
          </ul>
        {/if}

        {#if backup.active && activeLabel}
          <label class="flex items-start gap-x-2 text-sm">
            <input type="checkbox" class="mt-0.5 h-5 w-5" bind:checked={switchActive} />
            Make “{activeLabel}” (the backup’s active run) the active run on this device
          </label>
        {/if}

        {#if result}
          <p class="nz-ok" role="status" data-testid="restore-result">
            ✓ Restored {result.runs} run(s), {result.archives} archived attempt(s) and {result.knowledge} note(s).
            <a class="underline" href="/saves">Open your saves</a>
          </p>
        {:else}
          <button class="nz-btn primary w-fit" disabled={busy || (!added.length && !conflicts.length)} on:click={apply} data-testid="restore-apply">
            Apply
          </button>
        {/if}
      {/if}
    </section>
  </main>
</div>
