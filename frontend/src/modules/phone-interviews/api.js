import { apiGet, apiPatch, apiPost } from '../../api/client.js';

// Empty filters are left out of the address.
export function listPhoneInterviews(filters) {
  const query = new URLSearchParams();
  for (const [name, value] of Object.entries(filters)) {
    if (value !== '' && value !== null && value !== undefined) query.set(name, value);
  }
  return apiGet(`/phone-interviews?${query}`);
}

// One candidate with their phone interview (null if none has been recorded).
export const getPhoneInterview = (candidateId) =>
  apiGet(`/candidates/${candidateId}/phone-interview`);
export const createPhoneInterview = (data) => apiPost('/phone-interviews', data);
export const updatePhoneInterview = (id, data) => apiPatch(`/phone-interviews/${id}`, data);
