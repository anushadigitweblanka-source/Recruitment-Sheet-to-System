import { apiGet } from '../../api/client.js';

// Empty filters are left out of the address.
function withQuery(path, filters) {
  const query = new URLSearchParams();
  for (const [name, value] of Object.entries(filters ?? {})) {
    if (value !== '' && value !== null && value !== undefined) query.set(name, value);
  }
  const text = query.toString();
  return text ? `${path}?${text}` : path;
}

export const candidateStatusReport = (filters) =>
  apiGet(withQuery('/reports/candidate-status', filters));
export const funnelReport = (filters) => apiGet(withQuery('/reports/funnel', filters));
export const sourceReport = () => apiGet('/reports/sources');
export const positionReport = () => apiGet('/reports/positions');
export const weeklyReport = (filters) => apiGet(withQuery('/reports/weekly', filters));
export const onboardingReport = (filters) => apiGet(withQuery('/reports/onboarding', filters));
export const exitReport = (filters) => apiGet(withQuery('/reports/exit', filters));
// Main User only: the server refuses everyone else, and each view is audited.
export const salaryOfferReport = (filters) => apiGet(withQuery('/reports/salary-offers', filters));

// Downloads one report as a file. The session travels in the cookie like
// every other call; no token is handled here. Returns { ok, filename, blob }.
export async function exportReport(report, format, filters) {
  const path = withQuery(`/reports/${report}/export`, { ...filters, format });
  const res = await fetch(`/api${path}`, { headers: { Accept: '*/*' } });
  if (!res.ok) return { ok: false, status: res.status };

  const disposition = res.headers.get('content-disposition') ?? '';
  const filename = /filename="([^"]+)"/.exec(disposition)?.[1] ?? `${report}-export.${format}`;
  return { ok: true, filename, blob: await res.blob() };
}
