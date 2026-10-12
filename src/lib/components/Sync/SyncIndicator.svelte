<script>
  // Cross-device sync status in the nav; links to the Devices page. Hidden
  // when this device isn't connected.
  import { syncStatus, STATE_LABELS } from '$lib/sync/status'

  export let className = ''

  $: s = $syncStatus
  $: label = STATE_LABELS[s.state] || ''
</script>

{#if s.state !== 'off'}
  <a
    href="/devices"
    class="sync-indicator {s.state} {className}"
    title={s.message ? `${label}: ${s.message}` : label}
    data-testid="sync-indicator"
    data-state={s.state}
  >
    <span class="dot" aria-hidden="true" />
    <span class="label">{label}</span>
    <span class="sr-only">(device sync)</span>
  </a>
{/if}
<span class="sr-only" aria-live="polite">{s.state === 'error' || s.state === 'conflict' ? `Device sync: ${label}` : ''}</span>

<style lang="postcss">
  .sync-indicator {
    @apply inline-flex h-8 items-center gap-x-1.5 rounded-full px-2 text-xs font-medium;
  }
  .label {
    @apply hidden sm:inline;
  }
  .conflict .label,
  .error .label {
    @apply inline;
  }
  .dot {
    @apply inline-block h-2.5 w-2.5 rounded-full bg-gray-400;
  }
  .synced .dot {
    @apply bg-green-500;
  }
  .syncing .dot {
    @apply animate-pulse bg-sky-500;
  }
  .offline .dot {
    @apply bg-gray-400;
  }
  .conflict .dot {
    @apply bg-yellow-500;
  }
  .error .dot {
    @apply bg-red-500;
  }
  .conflict,
  .error {
    @apply border-2 border-current;
  }
  .conflict {
    @apply text-yellow-700;
  }
  .error {
    @apply text-red-600;
  }
  :global(.dark) .conflict {
    @apply text-yellow-400;
  }
  :global(.dark) .error {
    @apply text-red-400;
  }
</style>
