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

// The signed-in user's own in-app alerts (the bell in the header).
export const listMyAlerts = (limit = 20) => apiGet(`/me/notifications?limit=${limit}`);
export const markAlertRead = (id) => apiPost(`/me/notifications/${id}/read`);
export const markAllAlertsRead = () => apiPost('/me/notifications/read-all');
// Development only: runs the 15-minute job now. The backend refuses it in production.
export const runScheduler = () => apiPost('/notifications/run');

export const listTemplates = (filters) => apiGet(withQuery('/email-templates', filters));
export const createTemplate = (data) => apiPost('/email-templates', data);
export const updateTemplate = (id, data) => apiPatch(`/email-templates/${id}`, data);

export const listEmailLog = (filters) => apiGet(withQuery('/email-log', filters));
export const resendEmail = (id) => apiPost(`/email-log/${id}/resend`);

// Offer mails prepared by HR, waiting for the Main User.
export const listApprovals = () => apiGet('/email-approvals');
export const approveEmail = (id) => apiPost(`/email-log/${id}/approve`);
export const rejectEmail = (id, reason) => apiPost(`/email-log/${id}/reject`, { reason });
