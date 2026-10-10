<script>
  // What changed since the last accepted snapshot. Informational only.
  import { DIFF_STATUS } from '$lib/unbound/diff'
  import MonIcon from '$lib/components/Unbound/MonIcon.svelte'
  import day from '$lib/utils/date'

  export let diff, baseline, graveyardBox = 24

  const label = (m) => (m.nickname === m.species ? m.nickname : `${m.nickname} (${m.species})`)
  const pad = (n) => String(n).padStart(2, '0')
  const time = (t) => `${t.hours}:${pad(t.minutes)}`
  const item = (m, text) => ({ pid: m.pid, speciesId: m.speciesId, text })

  $: sections = diff.status === DIFF_STATUS.CHANGED
    ? [
        { title: 'Caught', items: diff.caught.map((m) => item(m, `${label(m)} · Lv ${m.level} · ${m.location}`)) },
        { title: 'Evolved', items: diff.evolved.map((m) => item(m, `${m.nickname}: ${m.from} → ${m.to}`)) },
        { title: 'Levelled up', items: diff.leveled.map((m) => item(m, `${m.nickname}: ${m.from} → ${m.to}`)) },
        { title: 'Moved', items: diff.moved.map((m) => item(m, `${m.nickname}: ${m.from} → ${m.to}`)) },
        { title: `Taken out of box ${graveyardBox}`, items: diff.leftGraveyard.map((m) => item(m, label(m))) },
        { title: 'No longer in party or PC', items: diff.missing.map((m) => item(m, label(m))) },
        { title: 'Fainted in party', items: diff.fainted.map((m) => item(m, label(m))) }
      ].filter((s) => s.items.length)
    : []
</script>

<section class="flex flex-col gap-y-3 text-sm" data-testid="save-changes">
  <h3 class="font-bold">Changes since last sync</h3>

  {#if diff.status === DIFF_STATUS.NO_BASELINE}
    <p>First sync for this run, so there's nothing to compare yet.</p>
  {:else}
    <p class="opacity-60">
      Last accepted: save #{baseline.snapshot.game.saveIndex} on {day(baseline.acceptedAt).format('D MMM, HH:mm')}
      (from {baseline.source})
    </p>

    {#if diff.status === DIFF_STATUS.SAME_SAVE}
      <p>This is the same save as last time. Nothing has changed.</p>
    {:else if diff.status === DIFF_STATUS.OLDER_SAVE}
      <p class="rounded-lg border-2 border-yellow-500 px-3 py-2" role="alert">
        This save is <b>older</b> than the one you last accepted. Delta may not have finished syncing.
      </p>
    {:else if diff.status === DIFF_STATUS.DIFFERENT_TRAINER}
      <p class="rounded-lg border-2 border-yellow-500 px-3 py-2" role="alert">
        This save belongs to a <b>different trainer</b>. Is it a new game or a new attempt? Changes can't be compared.
      </p>
    {:else}
      <p>
        Save #{diff.saveIndex.from} → #{diff.saveIndex.to} · playtime {time(diff.playtime.from)} → {time(diff.playtime.to)}
        {#if diff.badges.changed}· badges {diff.badges.from} → {diff.badges.to}{/if}
        {#if diff.levelCap.changed}· level cap {diff.levelCap.from} → {diff.levelCap.to}{/if}
      </p>

      {#if diff.enteredGraveyard.length}
        <div class="rounded-lg border-2 border-red-500 px-3 py-2" role="alert">
          <b>Possible deaths</b>, moved into box {graveyardBox}:
          <ul class="mt-1 flex flex-wrap gap-x-3">
            {#each diff.enteredGraveyard as m (m.pid)}
              <li class="inline-flex items-center"><MonIcon speciesId={m.speciesId} className="grayscale" />{label(m)}</li>
            {/each}
          </ul>
          <p class="mt-1 text-xs opacity-75">Not applied. Your tracker only changes when you confirm a death there.</p>
        </div>
      {/if}

      {#each sections as s}
        <div>
          <b>{s.title}</b>
          <ul>
            {#each s.items as i}
              <li class="flex items-center"><MonIcon speciesId={i.speciesId} />{i.text}</li>
            {/each}
          </ul>
        </div>
      {:else}
        {#if !diff.enteredGraveyard.length}<p>No Pokémon changes.</p>{/if}
      {/each}
    {/if}
  {/if}
</section>
