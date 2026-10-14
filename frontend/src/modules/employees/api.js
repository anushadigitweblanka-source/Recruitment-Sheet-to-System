import { apiGet, apiPatch, apiPost } from '../../api/client.js';

// Empty filters are left out of the address.
export function listEmployees(filters) {
  const query = new URLSearchParams();
  for (const [name, value] of Object.entries(filters)) {
    if (value !== '' && value !== null && value !== undefined) query.set(name, value);
  }
  return apiGet(`/employees?${query}`);
}

export const getEmployee = (id) => apiGet(`/employees/${id}`);
export const updateEmployee = (id, data) => apiPatch(`/employees/${id}`, data);
export const recordDecision = (id, data) => apiPost(`/employees/${id}/decision`, data);
export const recordTermination = (id, data) => apiPost(`/employees/${id}/termination`, data);
