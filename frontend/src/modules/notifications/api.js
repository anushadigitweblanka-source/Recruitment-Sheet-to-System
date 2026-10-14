import { apiGet, apiPatch, apiPost } from '../../api/client.js';

// Empty filters are left out of the address.
function withQuery(path, filters) {
  const query = new URLSearchParams();
  for (const [name, value] of Object.entries(filters ?? {})) {
    if (value !== '' && value !== null && value !== undefined) query.set(name, value);
  }
  const text = query.toString();
  return text ? `${path}?${text}` : path;
}

export const listNotifications = (filters) => apiGet(withQuery('/notifications', filters));
// Development only: runs the 15-minute job now. The backend refuses it in production.
export const runScheduler = () => apiPost('/notifications/run');

export const listTemplates = (filters) => apiGet(withQuery('/email-templates', filters));
export const createTemplate = (data) => apiPost('/email-templates', data);
export const updateTemplate = (id, data) => apiPatch(`/email-templates/${id}`, data);

export const listEmailLog = (filters) => apiGet(withQuery('/email-log', filters));
export const resendEmail = (id) => apiPost(`/email-log/${id}/resend`);
