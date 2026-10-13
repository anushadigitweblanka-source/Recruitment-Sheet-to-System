export const PHONE_INTERVIEW_COLUMNS = [
  { key: 'candidateCode', label: 'Candidate ID' },
  { key: 'candidateName', label: 'Candidate Name' },
  { key: 'phone', label: 'Phone' },
  { key: 'called', label: 'Called' },
  { key: 'response', label: 'Response' },
  { key: 'result', label: 'Result' },
  { key: 'interviewAt', label: 'Interview Date/Time' },
  { key: 'mailStatus', label: 'Mail Status' },
  { key: 'actions', label: 'Actions' },
];

// "Selected" and "Not Selected" are the two results the task guide names.
// The Response list has not been approved, so it is left undefined.
export const PHONE_INTERVIEW_FIELDS = [
  { name: 'candidateCode', label: 'Candidate ID', readOnly: true },
  { name: 'candidateName', label: 'Candidate Name', readOnly: true },
  { name: 'phone', label: 'Phone', type: 'tel', readOnly: true },
  { name: 'called', label: 'Called', type: 'checkbox' },
  { name: 'response', label: 'Response', type: 'select', pending: true },
  {
    name: 'result',
    label: 'Result',
    type: 'select',
    options: [
      { value: 'selected', label: 'Selected' },
      { value: 'not_selected', label: 'Not Selected' },
    ],
  },
  { name: 'interviewAt', label: 'Interview Date/Time', type: 'datetime-local' },
  {
    name: 'mailStatus',
    label: 'Mail Status',
    readOnly: true,
    hint: 'Set automatically from the email log; never typed by hand.',
  },
  { name: 'review', label: 'Review', type: 'textarea', wide: true },
  { name: 'hrNotes', label: 'HR Notes', type: 'textarea', wide: true },
];
