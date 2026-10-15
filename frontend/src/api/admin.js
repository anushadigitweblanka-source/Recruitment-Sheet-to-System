import { apiGet, apiPatch, apiPost } from './client.js';

// Empty filters are left out of the address.
function withQuery(path, filters) {
  const query = new URLSearchParams();
  for (const [name, value] of Object.entries(filters ?? {})) {
    if (value !== '' && value !== null && value !== undefined) query.set(name, value);
  }
  const text = query.toString();
  return text ? `${path}?${text}` : path;
}

export const listSettings = () => apiGet('/admin/settings');
export const updateSetting = (key, value) => apiPatch(`/admin/settings/${key}`, { value });
export const listAuditLog = (filters) => apiGet(withQuery('/admin/audit-log', filters));

export const listUsers = () => apiGet('/admin/users');
export const listRolesOverview = () => apiGet('/admin/roles');
export const listRoles = () => apiGet('/admin/users/roles');
export const createUser = (data) => apiPost('/admin/users', data);
export const setUserStatus = (id, isActive) => apiPatch(`/admin/users/${id}/status`, { isActive });
export const resetUserPassword = (id, password) =>
  apiPost(`/admin/users/${id}/reset-password`, { password });
