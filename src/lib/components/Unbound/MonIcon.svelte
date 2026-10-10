<script>
  // Pokémon icon from the app's local icon sheet (/assets/pokemon.css),
  // resolved from the Unbound species id. Unknown icons show "?".
  import { PIcon } from '$lib/components/core'
  import { describeSpecies, iconFor } from '$lib/unbound/species'

  export let speciesId,
    shiny = false,
    small = false,
    className = ''

  $: species = describeSpecies(speciesId)
</script>

<span class="relative inline-flex shrink-0 items-center justify-center {className}" title={species.label}>
  {#if small}
    <!-- The icon sheet is fixed at 68x56; scale it down inside a fixed box -->
    <span class="relative block h-7 w-8 overflow-hidden">
      <span class="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 scale-[0.55]">
        <PIcon name={iconFor(speciesId)} />
      </span>
    </span>
  {:else}
    <PIcon name={iconFor(speciesId)} className="-m-2" />
  {/if}
  {#if shiny}<span class="absolute right-0 top-0 text-xs text-yellow-500" aria-label="Shiny">✦</span>{/if}
</span>
