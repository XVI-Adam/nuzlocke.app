<script>
  // Shown when a page's data fails to load, instead of an endless spinner.
  // Nothing is changed: retrying just reloads the page.
  export let title = "Couldn't load this page",
    message = 'Check your connection and try again. Your runs and notes are saved on this device.'
</script>

<div class="mx-auto mt-24 flex max-w-sm flex-col items-center gap-y-3 px-4 text-center" role="alert" data-testid="error-state">
  <h2 class="text-lg font-bold">{title}</h2>
  <p class="text-sm opacity-75">{message}</p>
  <slot />
  <button
    class="min-h-[44px] rounded-lg border-2 px-4 hover:border-orange-500"
    on:click={() => window.location.reload()}
  >
    Try again
  </button>
</div>
