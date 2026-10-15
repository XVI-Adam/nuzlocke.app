<script>
  // Game-page panel showing facts from the run's last accepted save sync.
  // Read-only: it never writes tracker data. Encounters, deaths and other
  // Nuzlocke decisions stay in the tracker below it. The next-boss line is a
  // navigation hint; the starter suggestion only asks the page to apply the
  // player's choice when they press the button.
  import { createEventDispatcher, getContext, onMount } from 'svelte'
  import { slide } from 'svelte/transition'

  import PartyMon from './PartyMon.svelte'
  import MonIcon from './MonIcon.svelte'
  import { readSide } from '$lib/unbound/baseline'
  import { nextBosses, starterFromSave } from '$lib/unbound/progress'
  import { aliasFor } from '$lib/unbound/species'
  import { syncAge } from '$lib/unbound/freshness'
  import { DEFAULT_GRAVEYARD_BOX } from '$lib/unbound/diff'
  import { levelCapFor, overCap as findOverCap, capLabel } from '$lib/unbound/caps'
  import { metLabel } from '$lib/unbound/locations'

  export let runId,
    gameKey = 'unbound',
    routes = [], // the run's route list (boss order)
    defeated = [], // boss ids the player recorded as defeated (__teams)
    starter = 'fire' // the run's rival-team setting (__starter)

  const dispatch = createEventDispatcher()
  const { getLeague, getPkmn } = getContext('game')
  const STARTER_NAME = { fire: 'Gible', water: 'Beldum', grass: 'Larvitar' }

  const BADGE_COUNT = 8 // Unbound has eight gyms
  const OPEN_KEY = 'nuzlocke.unbound.panel'
  const pad = (n) => String(n).padStart(2, '0')

  let baseline = null,
    links = {},
    loaded = false,
    open = true

  onMount(() => {
    const side = readSide(runId)
    baseline = side.baseline
    links = side.links
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
  // Computed from badges rather than the stored snapshot value, so saves
  // accepted before the documented cap table still show the right cap
  $: capInfo = snapshot ? levelCapFor(snapshot.progress) : null
  $: cap = capInfo?.cap
  $: capTop = capInfo ? capInfo.upTo ?? capInfo.cap : null
  $: age = baseline ? syncAge(baseline.acceptedAt) : null
  $: ({ over: overCap, maybeOver } = findOverCap(snapshot?.party, capInfo))
  $: graveyard = snapshot?.boxes.find((b) => b.box === DEFAULT_GRAVEYARD_BOX)?.mons.length ?? 0

  // Next boss after the save's last badge, skipping bosses recorded as defeated
  $: upcoming = snapshot ? nextBosses(routes, snapshot.progress, defeated) : null
  $: badgeGoal = snapshot && snapshot.progress.badges < BADGE_COUNT ? `badge ${snapshot.progress.badges + 1}` : 'the Champion'
  const bossLabel = (r) => r.boss || r.name
  let aceLevel = null
  const loadAce = async (value, starterKey) => {
    aceLevel = null
    const league = await getLeague(gameKey, starterKey)
    const levels = (league?.[value]?.pokemon || []).map((p) => Number(p.level)).filter((n) => n > 0)
    if (upcoming?.next?.value === value) aceLevel = levels.length ? Math.max(...levels) : null
  }
  $: upcoming?.next && loadAce(upcoming.next.value, starter)

  // The starter from the save mon the player linked to the Starter record
  let saveStarter = null
  const resolveStarter = async (snap, sideLinks) => {
    const identity = Object.keys(sideLinks).find((k) => sideLinks[k] === 'Starter')
    const mons = [...snap.party, ...snap.boxes.flatMap((b) => b.mons)]
    const mon = identity && mons.find((m) => `${m.otId}:${m.pid}` === identity)
    const alias = mon && aliasFor(mon.species.id)
    const evoline = alias ? (await getPkmn(alias))?.evoline : null
    saveStarter = starterFromSave(snap, sideLinks, { aliasOf: aliasFor, evolineOf: () => evoline })
  }
  $: snapshot && resolveStarter(snapshot, links)
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
          <span class="ml-1 shrink-0 text-xs opacity-75">{snapshot.progress.badges}/{BADGE_COUNT} badges · cap {capLabel(capInfo)}</span>
          {#if upcoming?.next}
            <button class="ml-1 text-xs underline" on:click={() => dispatch('goto', upcoming.next.value)}>next: {bossLabel(upcoming.next)}</button>
          {/if}
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
              <dt class="text-xs opacity-60">Level cap</dt>
              <dd>{capLabel(capInfo)} · ₽{snapshot.progress.money.toLocaleString()}</dd>
            </div>
          </dl>

          {#if upcoming?.next}
            <div class="mt-2 rounded-lg border border-gray-300 px-2 py-1 dark:border-gray-600" data-testid="live-panel-next">
              <div class="flex flex-wrap items-center justify-between gap-x-2">
                <span>
                  <b>Next boss</b>
                  {bossLabel(upcoming.next)} <span class="opacity-60">· {upcoming.next.name}</span>
                  {#if aceLevel}
                    <span class="opacity-75">· ace Lv {aceLevel}</span>
                    {#if capTop != null && aceLevel > capTop}<span class="text-yellow-700 dark:text-yellow-500">(above your cap {capTop})</span>{/if}
                  {/if}
                </span>
                <button class="min-h-[2rem] text-xs underline" on:click={() => dispatch('goto', upcoming.next.value)}>Show card</button>
              </div>
              {#if upcoming.upcoming.length > 1}
                <p class="text-xs opacity-75">
                  Then, before {badgeGoal}: {upcoming.upcoming.slice(1).map(bossLabel).join(' · ')}
                </p>
              {/if}
              <p class="text-xs opacity-60">From your badges and the bosses you've recorded as defeated.</p>
            </div>
          {:else if snapshot.progress.champion}
            <p class="mt-2 text-xs" data-testid="live-panel-next">Champion - main story complete.</p>
          {/if}

          {#if saveStarter && saveStarter !== starter}
            <p class="mt-2 rounded-lg border border-yellow-500 px-2 py-1 text-xs" data-testid="live-panel-starter">
              Your save's Starter is a {STARTER_NAME[saveStarter]}, but rival teams are shown for {STARTER_NAME[starter]}.
              <button class="ml-1 underline" on:click={() => dispatch('starter', saveStarter)}>Show rival teams for {STARTER_NAME[saveStarter]}</button>
            </p>
          {/if}

          {#if overCap.length}
            <p class="mt-2 rounded-lg border border-red-500 px-2 py-1 text-xs text-red-600 dark:text-red-400" role="alert">
              Over the level cap of {capTop}: {overCap.map((m) => `${m.nickname} (Lv ${m.level})`).join(', ')}
            </p>
          {/if}
          {#if maybeOver.length}
            <p class="mt-2 rounded-lg border border-yellow-500 px-2 py-1 text-xs" data-testid="live-panel-maybe-over">
              Over {cap} - fine only if {capInfo.milestone.label} is done: {maybeOver.map((m) => `${m.nickname} (Lv ${m.level})`).join(', ')}
            </p>
          {/if}

          <div class="mt-2 grid grid-cols-2 gap-1.5 lg:grid-cols-3">
            {#each snapshot.party as mon (mon.pid)}
              <PartyMon {mon} cap={capTop} compact />
            {/each}
          </div>

          <details class="mt-1">
            <summary class="cursor-pointer text-xs opacity-75">Moves, items, abilities and met locations</summary>
            <ul class="mt-1 text-xs">
              {#each snapshot.party as m (m.pid)}
                <li><b>{m.nickname}</b> · {m.ability || '-'}{m.item ? ` · @${m.item}` : ''} · {m.moves.join(' / ')}{m.met ? ` · met ${metLabel(m)} Lv ${m.met.level}` : ''}</li>
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
