// Salary stays out of offer list fields and uses its own restricted table.

export const OFFER_COLUMNS = [
  { key: 'candidate', label: 'Candidate' },
  { key: 'position', label: 'Position' },
  { key: 'offerDate', label: 'Offer Date' },
  { key: 'workMode', label: 'Work Mode' },
  { key: 'location', label: 'Location' },
  { key: 'offerStatus', label: 'Offer Status' },
  { key: 'emailStatus', label: 'Email Status' },
  { key: 'onboardingDate', label: 'Onboarding Date' },
  { key: 'attended', label: 'Attended' },
  { key: 'actions', label: 'Actions' },
];

// The two statuses backed by the task guide's stage list ("Offer Sent",
// "Offer Accepted"). No other value has been approved.
export const OFFER_STATUS_OPTIONS = [
  { value: 'sent', label: 'Sent' },
  { value: 'accepted', label: 'Accepted' },
];
export const OFFER_EDIT_STATUS_OPTIONS = [
  ...OFFER_STATUS_OPTIONS,
  // UI draft only: no approved backend or database value exists for a decline.
  { value: 'not_accepted_draft', label: 'Not Accepted' },
];
export const SUPPORTED_OFFER_STATUS_VALUES = new Set(['', 'sent', 'accepted']);
export const OFFER_STATUS_LABELS = { sent: 'Sent', accepted: 'Accepted' };
export const OFFER_STATUS_TONES = { sent: 'info', accepted: 'success' };

// Online and Work from Home are selectable drafts, but the existing backend
// and database constraint currently permit saving Office only.
export const WORK_MODE_OPTIONS = [
  { value: 'online', label: 'Online' },
  { value: 'work_from_home', label: 'Work from Home' },
  { value: 'office', label: 'Office' },
];
export const SUPPORTED_WORK_MODE_VALUES = new Set(['', 'office']);
export const WORK_MODE_LABELS = {
  online: 'Online',
  work_from_home: 'Work from Home',
  office: 'Office',
};
export const workModeLabel = (workMode) =>
  workMode ? (WORK_MODE_LABELS[workMode] ?? workMode) : null;

export const ATTENDED_OPTIONS = [
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' },
];
export const attendedLabel = (attended) =>
  attended === true ? 'Yes' : attended === false ? 'No' : null;

// Email status is read from the email log by the server (the joining mail). It
// is never typed by hand and never stored with the offer. null means no
// joining mail has been prepared for the candidate.
const EMAIL_STATUS_LABELS = {
  sent: 'Sent',
  simulated: 'Simulated (not delivered)',
  failed: 'Failed',
  queued: 'Awaiting approval',
};
export const emailStatusLabel = (status) => EMAIL_STATUS_LABELS[status] ?? 'Not sent';
