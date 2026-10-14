export const NOTIFICATION_COLUMNS = [
  { key: 'subject', label: 'Candidate / Employee' },
  { key: 'type', label: 'Notification Type' },
  { key: 'dueAt', label: 'Due At' },
  { key: 'sendAt', label: 'Send At' },
  { key: 'sentAt', label: 'Sent At' },
  { key: 'status', label: 'Status' },
  { key: 'recipient', label: 'Recipient' },
];

export const EMAIL_TEMPLATE_COLUMNS = [
  { key: 'type', label: 'Template Type' },
  { key: 'subject', label: 'Subject' },
  { key: 'body', label: 'Body' },
  { key: 'active', label: 'Active' },
  { key: 'actions', label: 'Actions' },
];

export const EMAIL_LOG_COLUMNS = [
  { key: 'candidate', label: 'Candidate' },
  { key: 'template', label: 'Template' },
  { key: 'recipient', label: 'Recipient' },
  { key: 'sentAt', label: 'Sent At' },
  { key: 'status', label: 'Status' },
  { key: 'error', label: 'Error' },
  { key: 'resend', label: 'Resend' },
  { key: 'actions', label: 'Actions' },
];

// The six reminder types from the task guide, shown with readable names.
export const NOTIFICATION_TYPE_LABELS = {
  evaluation_end: 'Evaluation End',
  probation_end: 'Probation End',
  junior_end: 'Junior End',
  interview_reminder: 'Interview Reminder',
  joining_reminder: 'Joining Reminder',
  cv_pending: 'CV Pending',
};
export const NOTIFICATION_TYPE_OPTIONS = Object.entries(NOTIFICATION_TYPE_LABELS).map(
  ([value, label]) => ({ value, label }),
);
export const typeLabel = (type) => NOTIFICATION_TYPE_LABELS[type] ?? type;

export const NOTIFICATION_STATUS_LABELS = {
  pending: 'Scheduled',
  sent: 'Sent',
  failed: 'Failed',
  cancelled: 'Cancelled',
};
export const NOTIFICATION_STATUS_TONES = {
  pending: 'info',
  sent: 'success',
  failed: 'danger',
  cancelled: 'neutral',
};
export const NOTIFICATION_STATUS_OPTIONS = Object.entries(NOTIFICATION_STATUS_LABELS).map(
  ([value, label]) => ({ value, label }),
);

export const LOG_STATUS_LABELS = { queued: 'Queued', sent: 'Sent', failed: 'Failed' };
export const LOG_STATUS_TONES = { queued: 'info', sent: 'success', failed: 'danger' };
export const LOG_STATUS_OPTIONS = Object.entries(LOG_STATUS_LABELS).map(([value, label]) => ({
  value,
  label,
}));

export const SEND_MODE_OPTIONS = [
  { value: 'review', label: 'Review before sending' },
  { value: 'auto', label: 'Send automatically' },
];
