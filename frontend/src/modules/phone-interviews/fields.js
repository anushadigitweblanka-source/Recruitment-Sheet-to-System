export const PHONE_INTERVIEW_COLUMNS = [
  { key: 'candidateCode', label: 'Candidate ID' },
  { key: 'candidateName', label: 'Candidate Name' },
  { key: 'phone', label: 'Phone' },
  { key: 'called', label: 'Called' },
  { key: 'response', label: 'Response' },
  { key: 'result', label: 'Result' },
  { key: 'review', label: 'Review' },
  { key: 'interviewAt', label: 'Interview Date/Time' },
  { key: 'mailStatus', label: 'Mail Status' },
  { key: 'actions', label: 'Actions' },
];

// The two results named in the task guide.
export const RESULT_OPTIONS = [
  { value: 'selected', label: 'Selected' },
  { value: 'not_selected', label: 'Not Selected' },
];

export const RESULT_LABELS = { selected: 'Selected', not_selected: 'Not Selected' };
export const RESULT_TONES = { selected: 'success', not_selected: 'danger' };

// Email sending is not built, so there is no mail status to show yet. When it
// is built, the status will be read from the email log, never typed by hand.
export const MAIL_STATUS_NOT_AVAILABLE = 'Not available yet';
