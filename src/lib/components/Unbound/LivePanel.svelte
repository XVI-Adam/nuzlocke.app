<script>
  // Game-page panel showing facts from the run's last accepted save sync.
  // Read-only: it never writes tracker data. Encounters, deaths and other
  // Nuzlocke decisions stay in the tracker below it.
  import { onMount } from 'svelte'
  import { slide } from 'svelte/transition'

  import PartyMon from './PartyMon.svelte'
  import MonIcon from './MonIcon.svelte'
  import { readBaseline } from '$lib/unbound/baseline'
  import { syncAge } from '$lib/unbound/freshness'
  import { DEFAULT_GRAVEYARD_BOX } from '$lib/unbound/diff'

  export let runId, gameKey

  const BADGE_COUNT = 8 // Unbound has eight gyms
  const OPEN_KEY = 'nuzlocke.unbound.panel'
  const pad = (n) => String(n).padStart(2, '0')

  let baseline = null,
    loaded = false,
    open = true

  onMount(() => {
    baseline = readBaseline(runId)
    try {
      open = localStorage.getItem(OPEN_KEY) !== 'closed'
    } catch {
      /* per-device preference only */
    }
    loaded = true
  })

  const toggle = () => {
    open = !open
    try {
      localStorage.setItem(OPEN_KEY, open ? 'open' : 'closed')
    } catch {
      /* per-device preference only */
    }
  }

  $: snapshot = baseline?.snapshot
  $: capProfile = gameKey === 'unbound_exp' ? 'expert' : 'normal'
  $: cap = snapshot?.progress.levelCap[capProfile]
  $: age = baseline ? syncAge(baseline.acceptedAt) : null
  $: overCap = snapshot ? snapshot.party.filter((m) => m.level > cap) : []
  $: graveyard = snapshot?.boxes.find((b) => b.box === DEFAULT_GRAVEYARD_BOX)?.mons.length ?? 0
</script>

{#if loaded}
  <!-- max-md:mt-8 clears the Settings button, which is absolute on mobile -->
  <section
    class="w-full rounded-lg border-2 border-dashed border-gray-400 px-3 py-2 text-sm max-md:mt-8 dark:border-gray-600"
    aria-label="Live save"
    data-testid="live-panel"
  >
    {#if !snapshot}
      <div class="flex flex-wrap items-center justify-between gap-2" data-testid="live-panel-empty">
        <p>
          <b>Live save</b>
          <span class="opacity-75">No save synced for this run yet. Sync your Unbound save to see your party, badges and level cap here.</span>
        </p>
        <a href="/sync" class="rounded-lg border-2 px-3 py-1 hover:border-orange-500">Sync save</a>
      </div>
    {:else}
      <header class="flex items-center justify-between gap-2">
        <button class="flex min-w-0 flex-wrap items-center gap-x-2 text-left" on:click={toggle} aria-expanded={open}>
          <b class="shrink-0">From your save</b>
          <span class="text-xs" class:opacity-60={!age.stale} class:text-yellow-600={age.stale} data-testid="live-panel-age">
            synced {age.label}{age.stale ? ' · may be out of date' : ''}
          </span>
          <span class="shrink-0 text-xs opacity-60">{open ? '▾' : '▸'}</span>
        </button>
        <a href="/sync" class="shrink-0 text-xs underline">Sync</a>
      </header>

      {#if !open}
        <div class="mt-1 flex flex-wrap items-center gap-x-1" data-testid="live-panel-collapsed">
          {#each snapshot.party as m (m.pid)}<MonIcon speciesId={m.species.id} shiny={m.shiny} small />{/each}
          <span class="ml-1 shrink-0 text-xs opacity-75">{snapshot.progress.badges}/{BADGE_COUNT} badges · cap {cap}</span>
        </div>
      {:else}
        <div transition:slide|local={{ duration: 200 }}>
          <dl class="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4">
            <div><dt class="text-xs opacity-60">Trainer</dt><dd>{snapshot.trainer.name}</dd></div>
            <div>
              <dt class="text-xs opacity-60">Save</dt>
              <dd>#{snapshot.game.saveIndex} · {snapshot.playtime.hours}:{pad(snapshot.playtime.minutes)}</dd>
            </div>
            <div>
              <dt class="text-xs opacity-60">Badges</dt>
              <dd class="flex items-center gap-x-0.5" aria-label="{snapshot.progress.badges} of {BADGE_COUNT} badges">
                {#each Array(BADGE_COUNT) as _, i}
                  <span class="inline-block h-2.5 w-2.5 rounded-full" class:bg-yellow-500={i < snapshot.progress.badges} class:bg-gray-300={i >= snapshot.progress.badges} class:dark:bg-gray-600={i >= snapshot.progress.badges} />
                {/each}
                <span class="ml-1 text-xs">{snapshot.progress.badges}/{BADGE_COUNT}</span>
              </dd>
            </div>
            <div>
              <dt class="text-xs opacity-60">Level cap ({capProfile})</dt>
              <dd>{snapshot.progress.champion ? 'None (champion)' : cap} · ₽{snapshot.progress.money.toLocaleString()}</dd>
            </div>
          </dl>

          {#if overCap.length && !snapshot.progress.champion}
            <p class="mt-2 rounded border border-red-500 px-2 py-1 text-xs text-red-600 dark:text-red-400" role="alert">
              Over the level cap of {cap}: {overCap.map((m) => `${m.nickname} (Lv ${m.level})`).join(', ')}
            </p>
          {/if}

          <div class="mt-2 grid grid-cols-2 gap-1.5 lg:grid-cols-3">
            {#each snapshot.party as mon (mon.pid)}
              <PartyMon {mon} cap={snapshot.progress.champion ? null : cap} compact />
            {/each}
          </div>

          <details class="mt-1">
            <summary class="cursor-pointer text-xs opacity-75">Moves, items and abilities</summary>
            <ul class="mt-1 text-xs">
              {#each snapshot.party as m (m.pid)}
                <li><b>{m.nickname}</b> · {m.ability || '-'}{m.item ? ` · @${m.item}` : ''} · {m.moves.join(' / ')}</li>
              {/each}
            </ul>
          </details>

          <p class="mt-1 text-xs opacity-60">
            Game facts from save #{snapshot.game.saveIndex} ({graveyard} in box {DEFAULT_GRAVEYARD_BOX}). Encounters and deaths below are your tracker's records.
          </p>
        </div>
      {/if}
    {/if}
  </section>
{/if}
