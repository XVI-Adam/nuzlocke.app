<script>
  // One party Pokémon from a parsed save snapshot. Read-only game facts.
  import MonIcon from './MonIcon.svelte'
  import { describeSpecies } from '$lib/unbound/species'
  import { metLabel } from '$lib/unbound/locations'

  export let mon,
    cap = null,
    compact = false

  const STATUS = {
    sleep: ['SLP', 'bg-gray-500'],
    poison: ['PSN', 'bg-purple-600'],
    toxic: ['TOX', 'bg-purple-800'],
    burn: ['BRN', 'bg-red-600'],
    freeze: ['FRZ', 'bg-sky-500'],
    paralysis: ['PAR', 'bg-yellow-500'],
    unknown: ['?', 'bg-gray-400']
  }

  $: species = describeSpecies(mon.species.id)
  $: ratio = mon.hp.max ? mon.hp.current / mon.hp.max : 0
  $: fainted = mon.hp.current === 0
  $: overCap = cap != null && mon.level > cap
  $: status = mon.status ? STATUS[mon.status] || STATUS.unknown : null
</script>

<div
  class="flex items-center gap-x-2 rounded-lg border-2 border-gray-300 px-2 py-1 text-sm dark:border-gray-600"
  class:opacity-60={fainted}
  data-testid="party-mon"
>
  <MonIcon speciesId={mon.species.id} shiny={mon.shiny} />
  <div class="min-w-0 flex-1">
    {#if compact}
      <div class="truncate"><b>{mon.nickname}</b></div>
      <div class="truncate text-xs">
        <span class:font-bold={overCap} class:text-red-500={overCap} title={overCap ? `Above level cap ${cap}` : ''}>
          Lv {mon.level}{overCap ? ' ▲' : ''}
        </span>
        {#if mon.nickname !== species.label}<span class="opacity-60">· {species.label}</span>{/if}
      </div>
    {:else}
      <div class="flex items-baseline justify-between gap-x-2">
        <span class="truncate">
          <b>{mon.nickname}</b>
          {#if mon.nickname !== species.label}<span class="opacity-60">{species.label}</span>{/if}
        </span>
        <span class="shrink-0" class:font-bold={overCap} class:text-red-500={overCap} title={overCap ? `Above level cap ${cap}` : ''}>
          Lv {mon.level}{overCap ? ' ▲' : ''}
        </span>
      </div>
    {/if}
    <div class="mt-1 flex items-center gap-x-2">
      <div class="h-1.5 flex-1 rounded bg-gray-200 dark:bg-gray-700" title="HP {mon.hp.current}/{mon.hp.max}">
        <div
          class="h-1.5 rounded"
          class:bg-green-500={ratio > 0.5}
          class:bg-yellow-500={ratio <= 0.5 && ratio > 0.2}
          class:bg-red-500={ratio <= 0.2}
          style="width: {100 * ratio}%"
        />
      </div>
      {#if fainted}
        <span class="rounded bg-gray-700 px-1 text-[10px] font-bold text-white">FNT</span>
      {:else if status}
        <span class="rounded px-1 text-[10px] font-bold text-white {status[1]}">{status[0]}</span>
      {/if}
    </div>
    {#if !compact}
      <div class="mt-1 text-xs opacity-75">
        HP {mon.hp.current}/{mon.hp.max}{mon.ability ? ` · ${mon.ability}` : ''}{mon.nature ? ` · ${mon.nature}` : ''}{mon.item ? ` · @${mon.item}` : ''}
      </div>
      {#if mon.moves?.length}<div class="text-xs opacity-75">{mon.moves.join(' / ')}</div>{/if}
      {#if mon.met}<div class="text-xs opacity-75" data-testid="party-mon-met">Met: {metLabel(mon)} (Lv {mon.met.level})</div>{/if}
    {/if}
  </div>
</div>
