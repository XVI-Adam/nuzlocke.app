<script>
  import { page } from '$app/stores'

  import Icon from '@iconify/svelte/dist/OfflineIcon.svelte'
  import { Home } from '$icons'

  import ThemeToggle from '$lib/components/theme-toggle.svelte'
  import SyncIndicator from '$lib/components/Sync/SyncIndicator.svelte'

</script>


<nav>
  <div class=p-container>
    {#if $page.url.pathname !== '/'}
      <a
        href=/
        rel=external
        aria-label=Home
        >
        <Icon inline={true} icon={Home} height=1.4rem class='fill-current' />
      </a>
    {:else}
      <span />
    {/if}

    <span class="inline-flex items-center gap-x-2">
      <SyncIndicator className="mt-2" />
      <ThemeToggle className="mt-2 min-h-[44px] min-w-[44px]" />
    </span>
  </div>
</nav>

<style lang="postcss">
  nav { @apply container mx-auto mb-8 md:mb-2 py-4 -mb-16 sm:text-black sm:bg-transparent; }

  :global(.dark) nav { @apply text-gray-200; }

  a {
    @apply border-b-2 ml-4 pb-1 border-b-transparent transition hover:border-b-current;
    @apply inline-flex min-h-[44px] min-w-[44px] items-center justify-center;
  }

</style>
