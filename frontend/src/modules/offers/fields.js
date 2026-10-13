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

// Position, Work Mode and Offer Status lists have not been approved yet.
export const OFFER_FIELDS = [
  { name: 'candidate', label: 'Candidate', readOnly: true },
  { name: 'position', label: 'Position', type: 'select', pending: true },
  { name: 'offerDate', label: 'Offer Date', type: 'date' },
  { name: 'workMode', label: 'Work Mode', type: 'select', pending: true },
  { name: 'location', label: 'Location' },
  { name: 'offerStatus', label: 'Offer Status', type: 'select', pending: true },
  {
    name: 'emailStatus',
    label: 'Email Status',
    readOnly: true,
    hint: 'Set automatically from the email log; never typed by hand.',
  },
  { name: 'onboardingDate', label: 'Onboarding Date', type: 'date' },
  { name: 'attended', label: 'Attended', type: 'checkbox' },
];
