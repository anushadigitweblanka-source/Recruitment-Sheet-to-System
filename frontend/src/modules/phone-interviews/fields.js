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

// How the call went. Stored as these exact words; separate from Result.
export const RESPONSE_OPTIONS = [
  'Interested',
  'Not Interested',
  'Call Back Later',
  'No Answer',
  'Busy',
  'Not Reachable',
  'Wrong Number',
].map((value) => ({ value, label: value }));

export const RESULT_LABELS = { selected: 'Selected', not_selected: 'Not Selected' };
export const RESULT_TONES = { selected: 'success', not_selected: 'danger' };

// The mail status is read from the email log by the server, never typed by
// hand. null means no such mail has been prepared for the candidate.
const MAIL_STATUS_LABELS = {
  sent: 'Sent',
  simulated: 'Simulated (not delivered)',
  failed: 'Failed',
  queued: 'Awaiting approval',
};
export const mailStatusLabel = (status) => MAIL_STATUS_LABELS[status] ?? 'Not sent';

// Why the status reads as it does, shown under the read-only field.
const MAIL_STATUS_HINTS = {
  sent: 'The invitation email was delivered. Read from the email log.',
  simulated:
    'The system is in development mode: the email was logged but nothing was delivered. Real delivery needs an approved email service.',
  failed: 'The last attempt failed. See the Email Log for the reason.',
  queued: 'Waiting for the Main User to approve the email.',
};
export const mailStatusHint = (status) =>
  MAIL_STATUS_HINTS[status] ??
  'No invitation email has been sent or logged for this candidate yet. This updates by itself from the email log.';
