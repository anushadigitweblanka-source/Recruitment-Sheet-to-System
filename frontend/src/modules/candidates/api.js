import { apiGet, apiPost, apiPut } from '../../api/client.js';

// Empty filters are left out of the address.
export function listCandidates(filters) {
  const query = new URLSearchParams();
  for (const [name, value] of Object.entries(filters)) {
    if (value !== '' && value !== null && value !== undefined) query.set(name, value);
  }
  return apiGet(`/candidates?${query}`);
}

export const getCandidate = (id) => apiGet(`/candidates/${id}`);
export const createCandidate = (data) => apiPost('/candidates', data);
export const updateCandidate = (id, data) => apiPut(`/candidates/${id}`, data);
