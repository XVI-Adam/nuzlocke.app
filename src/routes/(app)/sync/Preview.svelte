<script>
  // Read-only view of a parsed save snapshot
  export let snapshot,
    capProfile = 'normal',
    graveyardBox = 24

  const pad = (n) => String(n).padStart(2, '0')

  $: ({ game, trainer, playtime, progress, party, boxes, warnings } = snapshot)
  $: graveyard = boxes.find((b) => b.box === graveyardBox)?.mons || []
  $: stored = boxes.filter((b) => b.box !== graveyardBox && b.mons.length)
  $: boxTotal = stored.reduce((n, b) => n + b.mons.length, 0)
  $: cap = progress.levelCap[capProfile]
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
    <div><dt class="opacity-60">Level cap ({capProfile})</dt><dd>{cap}</dd></div>
    <div><dt class="opacity-60">Money</dt><dd>₽{progress.money.toLocaleString()}</dd></div>
    <div><dt class="opacity-60">PC</dt><dd>{boxTotal} stored · {graveyard.length} in box {graveyardBox}</dd></div>
  </dl>

  <div>
    <h3 class="mb-2 font-bold">Party</h3>
    <ul class="grid gap-2 sm:grid-cols-2">
      {#each party as m (m.pid)}
        <li class="rounded-lg border-2 border-gray-300 px-3 py-2 text-sm dark:border-gray-600">
          <div class="flex items-baseline justify-between gap-x-2">
            <span>
              <b>{m.nickname}</b>
              {#if m.nickname !== m.species.name}<span class="opacity-60">({m.species.name})</span>{/if}
              {#if m.shiny}<span title="Shiny">✦</span>{/if}
            </span>
            <span class:text-red-500={m.level > cap}>Lv {m.level}</span>
          </div>
          <div class="mt-1 h-1.5 w-full rounded bg-gray-200 dark:bg-gray-700">
            <div
              class="h-1.5 rounded"
              class:bg-green-500={m.hp.current / m.hp.max > 0.5}
              class:bg-yellow-500={m.hp.current / m.hp.max <= 0.5 && m.hp.current / m.hp.max > 0.2}
              class:bg-red-500={m.hp.current / m.hp.max <= 0.2}
              style="width: {(100 * m.hp.current) / m.hp.max}%"
            />
          </div>
          <div class="mt-1 text-xs opacity-75">
            HP {m.hp.current}/{m.hp.max} · {m.ability} · {m.nature}{m.item ? ` · @${m.item}` : ''}
          </div>
          <div class="text-xs opacity-75">{m.moves.join(' / ')}</div>
        </li>
      {/each}
    </ul>
  </div>

  <div>
    <h3 class="mb-2 font-bold">Box {graveyardBox} (graveyard)</h3>
    {#if graveyard.length}
      <p class="text-sm">
        {graveyard.map((m) => `${m.nickname} (${m.species.name}, Lv ${m.level})`).join(', ')}
      </p>
    {:else}
      <p class="text-sm opacity-60">Empty</p>
    {/if}
  </div>

  {#if stored.length}
    <details>
      <summary class="cursor-pointer font-bold">Other boxes ({boxTotal})</summary>
      <ul class="mt-2 text-sm">
        {#each stored as b (b.box)}
          <li><span class="opacity-60">Box {b.box}:</span> {b.mons.map((m) => `${m.nickname} (Lv ${m.level})`).join(', ')}</li>
        {/each}
      </ul>
    </details>
  {/if}
</section>
