import { apiDelete, apiGet, apiPatch, apiPost, apiPut, apiPutFile } from './client.js';

// Salary (Main User only; the server refuses everyone else).
export const getSalary = (candidateId) => apiGet(`/salary/${candidateId}`);
export const saveSalary = (candidateId, salaryLkr) =>
  apiPut(`/salary/${candidateId}`, { salaryLkr });

// Team Lead mapping.
export const listTeamLeads = () => apiGet('/admin/team-leads');
export const createTeamLead = (data) => apiPost('/admin/team-leads', data);
export const updateTeamLead = (id, data) => apiPatch(`/admin/team-leads/${id}`, data);

// Company accounts and their temporary passwords.
export const listCompanyAccounts = (status) =>
  apiGet(`/company-accounts${status ? `?status=${status}` : ''}`);
export const markAccountCreated = (id, data) => apiPost(`/company-accounts/${id}/created`, data);
export const markAccountHandedOver = (id, data) =>
  apiPost(`/company-accounts/${id}/handed-over`, data);
export const markAccountDisabled = (id, data) => apiPost(`/company-accounts/${id}/disabled`, data);
export const setAccountPassword = (id, password) =>
  apiPut(`/company-accounts/${id}/password`, { password });
export const resetAccountPassword = (id) => apiPost(`/company-accounts/${id}/password/reset`);
export const revealAccountPassword = (id, loginPassword) =>
  apiPost(`/company-accounts/${id}/password/reveal`, { loginPassword });
export const clearAccountPassword = (id) => apiDelete(`/company-accounts/${id}/password`);

// One-off mails for a candidate.
export const previewEmail = (candidateId, type) =>
  apiPost(`/candidates/${candidateId}/emails/preview`, { type });
export const sendEmail = (candidateId, data) =>
  apiPost(`/candidates/${candidateId}/emails/send`, data);

// The candidate's own upload page (no sign-in).
export const checkCompanyCvLink = (token) => apiGet(`/public/company-cv/${token}`);
export const uploadCompanyCv = (token, file) => apiPutFile(`/public/company-cv/${token}`, file);
