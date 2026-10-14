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
