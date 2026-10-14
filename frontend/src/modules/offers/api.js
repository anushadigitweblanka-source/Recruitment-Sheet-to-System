import { apiGet, apiPatch, apiPost } from '../../api/client.js';

// Empty filters are left out of the address.
export function listOffers(filters) {
  const query = new URLSearchParams();
  for (const [name, value] of Object.entries(filters)) {
    if (value !== '' && value !== null && value !== undefined) query.set(name, value);
  }
  return apiGet(`/offers?${query}`);
}

export const getOffer = (id) => apiGet(`/offers/${id}`);
export const createOffer = (data) => apiPost('/offers', data);
export const updateOffer = (id, data) => apiPatch(`/offers/${id}`, data);
