import { apiGet, apiPost, apiPostFile, apiPut } from '../../api/client.js';

// Empty filters are left out of the address.
export function listCandidates(filters) {
  const query = new URLSearchParams();
  for (const [name, value] of Object.entries(filters)) {
    if (value !== '' && value !== null && value !== undefined) query.set(name, value);
  }
  return apiGet(`/candidates?${query}`);
}

export const getCandidate = (id) => apiGet(`/candidates/${id}`);
// The ID the next saved candidate would get. A preview only: nothing is reserved.
export const previewCandidateId = () => apiGet('/candidates/next-id');
export const createCandidate = (data) => apiPost('/candidates', data);
export const updateCandidate = (id, data) => apiPut(`/candidates/${id}`, data);

// Reading a CV only previews its details; nothing is saved by these calls.
export const extractCvFile = (file, contentType) =>
  apiPostFile('/candidates/extract-cv/file', file, contentType);
export const extractCvLink = (url) => apiPost('/candidates/extract-cv/link', { url });
