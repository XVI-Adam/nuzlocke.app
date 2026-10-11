<!-- Shared form/card styles for the history, notes and backup pages -->
<style lang="postcss">
  :global(.nz-card) {
    @apply rounded-xl border-2 border-gray-200 p-3 sm:p-4;
  }
  :global(.nz-label) {
    @apply flex flex-col gap-y-1 text-sm font-medium;
  }
  :global(.nz-input) {
    @apply w-full rounded-lg border-2 border-gray-300 bg-white px-3 py-2 text-base font-normal sm:text-sm;
  }
  :global(.nz-input:focus) {
    @apply border-orange-400 outline-none;
  }
  :global(textarea.nz-input) {
    @apply min-h-[5rem];
  }
  :global(.nz-btn) {
    @apply inline-flex h-10 min-w-[2.75rem] items-center justify-center rounded-lg border-2 border-gray-300 px-3 text-sm transition-colors hover:border-orange-400
  }
  :global(.nz-btn:disabled) {
    @apply cursor-not-allowed opacity-50;
  }
  :global(.nz-btn.primary) {
    @apply border-orange-500 bg-orange-500 font-medium text-white hover:bg-orange-600;
  }
  :global(.nz-btn.danger) {
    @apply border-red-600 text-red-600 hover:bg-red-600 hover:text-white
  }
  :global(.nz-btn.danger.solid) {
    @apply bg-red-600 text-white;
  }
  :global(.nz-alert) {
    @apply rounded-lg border-2 border-red-500 px-3 py-2 text-sm;
  }
  :global(.nz-ok) {
    @apply rounded-lg border-2 border-green-600 px-3 py-2 text-sm;
  }
  :global(.nz-muted) {
    @apply text-sm opacity-60;
  }
  :global(.nz-chip) {
    @apply inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium;
  }
  :global(.nz-status-archived) {
    @apply bg-gray-200 text-gray-800
  }
  :global(.nz-status-abandoned) {
    @apply bg-yellow-200 text-yellow-900;
  }
  :global(.nz-status-lost) {
    @apply bg-red-200 text-red-900;
  }
  :global(.nz-status-completed) {
    @apply bg-green-200 text-green-900;
  }
  :global(.dark .nz-card) {
    @apply border-gray-700;
  }
  :global(.dark .nz-input) {
    @apply border-gray-600 bg-gray-900;
  }
  :global(.dark .nz-btn) {
    @apply border-gray-600;;
  }
  :global(.dark .nz-btn.danger) {
    @apply border-red-500 text-red-400;;
  }
  :global(.dark .nz-status-archived) {
    @apply bg-gray-700 text-gray-100;;
  }
</style>
