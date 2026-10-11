<script>
  // Recorded facts about an attempt (see summarizeAttempt). Unknown stays unknown.
  import { PIcon } from '$c/core'
  import { fmtKnown } from './format'

  export let stats
</script>

{#if stats}
  <dl class="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
    <div><dt class="nz-muted">Badges (last accepted save)</dt><dd class="font-medium">{fmtKnown(stats.badges)}</dd></div>
    <div><dt class="nz-muted">Deaths recorded</dt><dd class="font-medium">{stats.deaths}</dd></div>
    <div><dt class="nz-muted">Encounters recorded</dt><dd class="font-medium">{stats.encounters}</dd></div>
    <div><dt class="nz-muted">Boss fights recorded</dt><dd class="font-medium">{stats.bossFights}</dd></div>
  </dl>
  {#if stats.team.length}
    <div class="mt-2 flex flex-wrap items-center gap-1" aria-label="Team">
      {#each stats.team as name}
        <span class="relative h-8 w-8" title={name}>
          <PIcon class="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2" {name} />
        </span>
      {/each}
    </div>
  {:else}
    <p class="nz-muted mt-1">No active team recorded.</p>
  {/if}
{:else}
  <p class="nz-muted">The archived data for this attempt is missing.</p>
{/if}
