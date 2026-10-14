import Routes from '$lib/data/routes.json';
import { withEncounterDetails } from '$lib/unbound/encounters';

export async function GET({ params }) {
  const { gen } = params;

  if (!Routes[gen]) return new Response({ status: 404 });

  // Documented Unbound routes also carry per-species encounter details
  const routes = gen.startsWith('unbound') ? withEncounterDetails(Routes[gen]) : Routes[gen];

  return new Response(JSON.stringify(routes), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 's-maxage=1, stale-while-revalidate'
    }
  });
}
