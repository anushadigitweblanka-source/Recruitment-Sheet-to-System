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
export const OFFER_STATUS_LABELS = { sent: 'Sent', accepted: 'Accepted' };
export const OFFER_STATUS_TONES = { sent: 'info', accepted: 'success' };

// "Office" is approved as a temporary Work Mode value that still requires
// mentor confirmation. A confirmed list replaces this one.
export const WORK_MODE_OPTIONS = [{ value: 'office', label: 'Office' }];
export const WORK_MODE_LABELS = { office: 'Office' };
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
