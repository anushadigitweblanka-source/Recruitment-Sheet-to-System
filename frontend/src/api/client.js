// All backend calls go through here, so there is one place to add
// authentication headers and error handling later.
export async function apiGet(path) {
  const res = await fetch(`/api${path}`, { headers: { Accept: 'application/json' } });
  const body = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, body };
}
