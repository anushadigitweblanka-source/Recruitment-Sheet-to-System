import { apiGet, apiPost } from './client.js';

export const listLookup = (list) => apiGet(`/lookups/${list}`);
export const addLookup = (list, name) => apiPost(`/lookups/${list}`, { name });

// The three lists the candidate screens need, fetched together.
export async function loadCandidateLookups() {
  const [positions, sources, stages] = await Promise.all([
    apiGet('/lookups/positions'),
    apiGet('/lookups/sources'),
    apiGet('/lookups/stages'),
  ]);
  const failed = [positions, sources, stages].find((res) => !res.ok);
  if (failed) return { ok: false, status: failed.status, body: null };

  return {
    ok: true,
    status: 200,
    body: {
      positions: positions.body.items,
      sources: sources.body.items,
      stages: stages.body.items,
    },
  };
}
