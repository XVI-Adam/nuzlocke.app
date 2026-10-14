import Routes from '$lib/data/routes.json';
import { withEncounterDetails } from '$lib/unbound/encounters';
import { withBossChecks } from '$lib/unbound/bosses';

export async function GET({ params }) {
  const { gen } = params;

  if (!Routes[gen]) return new Response({ status: 404 });

  // Unbound routes also carry documented encounter details and each boss's wiki check
  const routes = gen.startsWith('unbound') ? withBossChecks(withEncounterDetails(Routes[gen])) : Routes[gen];

  return new Response(JSON.stringify(routes), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 's-maxage=1, stale-while-revalidate'
    }
  });
}
