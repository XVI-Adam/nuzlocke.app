<script>
  // Read-only view of a parsed save snapshot
  import PartyMon from '$lib/components/Unbound/PartyMon.svelte'
  import MonIcon from '$lib/components/Unbound/MonIcon.svelte'
  import { describeSpecies } from '$lib/unbound/species'
  import { levelCapFor, capLabel } from '$lib/unbound/caps'

  export let snapshot,
    graveyardBox = 24

  const pad = (n) => String(n).padStart(2, '0')

  $: ({ game, trainer, playtime, progress, party, boxes, warnings } = snapshot)
  $: graveyard = boxes.find((b) => b.box === graveyardBox)?.mons || []
  $: stored = boxes.filter((b) => b.box !== graveyardBox && b.mons.length)
  $: boxTotal = stored.reduce((n, b) => n + b.mons.length, 0)
  $: capInfo = levelCapFor(progress)
  // Only flag mons that are over the cap whichever side of a milestone the run is
  $: cap = capInfo.upTo ?? capInfo.cap
</script>

<section class="flex flex-col gap-y-4" data-testid="save-preview">
  {#each warnings as w}
    <p class="rounded-lg border-2 border-yellow-500 px-3 py-2 text-sm" role="alert">{w.message}</p>
  {/each}

  <dl class="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
    <div><dt class="opacity-60">Game</dt><dd>{game.version}</dd></div>
    <div><dt class="opacity-60">Save</dt><dd>#{game.saveIndex} (slot {game.slot})</dd></div>
    <div><dt class="opacity-60">Trainer</dt><dd>{trainer.name}</dd></div>
    <div>
      <dt class="opacity-60">Playtime</dt>
      <dd>{playtime.hours}:{pad(playtime.minutes)}:{pad(playtime.seconds)}</dd>
    </div>
    <div><dt class="opacity-60">Badges</dt><dd>{progress.badges}{progress.champion ? ' · Champion' : ''}</dd></div>
    <div><dt class="opacity-60">Level cap</dt><dd>{capLabel(capInfo)}</dd></div>
    <div><dt class="opacity-60">Money</dt><dd>₽{progress.money.toLocaleString()}</dd></div>
    <div><dt class="opacity-60">PC</dt><dd>{boxTotal} stored · {graveyard.length} in box {graveyardBox}</dd></div>
  </dl>

  <div>
    <h3 class="mb-2 font-bold">Party</h3>
    <div class="grid gap-2 sm:grid-cols-2">
      {#each party as mon (mon.pid)}
        <PartyMon {mon} {cap} />
      {/each}
    </div>
  </div>

  <div>
    <h3 class="mb-2 font-bold">Box {graveyardBox} (graveyard)</h3>
    {#if graveyard.length}
      <ul class="flex flex-wrap gap-2 text-sm">
        {#each graveyard as m (m.pid)}
          <li class="inline-flex items-center gap-x-1 pr-2">
            <MonIcon speciesId={m.species.id} shiny={m.shiny} className="grayscale" />
            <span>{m.nickname} <span class="opacity-60">{describeSpecies(m.species.id).label} · Lv {m.level}</span></span>
          </li>
        {/each}
      </ul>
    {:else}
      <p class="text-sm opacity-60">Empty</p>
    {/if}
  </div>

  {#if stored.length}
    <details>
      <summary class="cursor-pointer font-bold">Other boxes ({boxTotal})</summary>
      {#each stored as b (b.box)}
        <div class="mt-2 text-sm">
          <span class="opacity-60">Box {b.box}</span>
          <ul class="flex flex-wrap">
            {#each b.mons as m (m.pid)}
              <li class="inline-flex items-center pr-2" title="{m.nickname} · {describeSpecies(m.species.id).label} · Lv {m.level}">
                <MonIcon speciesId={m.species.id} shiny={m.shiny} />
                <span class="text-xs">{m.nickname} <span class="opacity-60">Lv {m.level}</span></span>
              </li>
            {/each}
          </ul>
        </div>
      {/each}
    </details>
  {/if}
</section>
