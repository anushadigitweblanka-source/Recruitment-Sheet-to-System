// Salary functionality pending mentor approval and authorization design.
// No salary field belongs in this file: the proposal keeps salary in its own
// restricted table, readable only with a dedicated permission.

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

export const ATTENDED_OPTIONS = [
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' },
];
export const attendedLabel = (attended) =>
  attended === true ? 'Yes' : attended === false ? 'No' : null;

// Email status is read from the email log, which belongs to Module 6 and does
// not exist yet. It is never typed by hand and never stored with the offer.
export const EMAIL_STATUS_UNAVAILABLE = 'Not available yet';
