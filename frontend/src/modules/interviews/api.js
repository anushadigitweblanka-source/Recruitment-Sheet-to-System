import { apiGet, apiPatch, apiPost } from '../../api/client.js';

// Empty filters are left out of the address.
export function listInterviews(filters) {
  const query = new URLSearchParams();
  for (const [name, value] of Object.entries(filters)) {
    if (value !== '' && value !== null && value !== undefined) query.set(name, value);
  }
  return apiGet(`/interviews?${query}`);
}

export const getInterview = (id) => apiGet(`/interviews/${id}`);
export const createInterview = (data) => apiPost('/interviews', data);
export const updateInterview = (id, data) => apiPatch(`/interviews/${id}`, data);
