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

// The two send modes in the task guide: the system sends by itself (Auto), or
// HR previews the mail and presses one button (One-click). Each mail type
// allows only some of them; the server enforces that.
export const SEND_MODE_OPTIONS = [
  { value: 'one_click', label: 'One-click (HR previews and sends)' },
  { value: 'auto', label: 'Auto (sent by the system)' },
];

// The mail types in the task guide. These are the only template types.
export const TEMPLATE_TYPE_LABELS = {
  interview_invitation: 'Direct interview invitation',
  team_lead_summary: 'Team Lead candidate summary / interview slot',
  joining_onboarding: 'Joining / onboarding mail',
  interview_reminder: 'Interview reminder (24 hours before)',
  joining_reminder: 'Joining reminder (24 hours before)',
  phase_end_reminder: 'Phase-end reminder (evaluation, probation, junior)',
  status_rejected_on_hold: 'Rejected / On Hold status mail',
  cv_pending_reminder: 'Company CV reminder',
};
// The send modes each type allows (task guide). Where it says "Auto or
// One-click" both are offered and the choice is the template's.
export const TEMPLATE_TYPE_MODES = {
  interview_invitation: ['one_click', 'auto'],
  team_lead_summary: ['one_click', 'auto'],
  joining_onboarding: ['one_click'],
  interview_reminder: ['auto'],
  joining_reminder: ['auto'],
  phase_end_reminder: ['auto'],
  status_rejected_on_hold: ['one_click'],
  cv_pending_reminder: ['auto'],
};

export const TEMPLATE_TYPE_OPTIONS = Object.entries(TEMPLATE_TYPE_LABELS).map(([value, label]) => ({
  value,
  label,
}));

// The mails HR sends by hand from a candidate's page. The reminders are sent
// by the scheduler only.
export const MANUAL_MAIL_TYPE_OPTIONS = TEMPLATE_TYPE_OPTIONS.filter(({ value }) =>
  [
    'interview_invitation',
    'team_lead_summary',
    'joining_onboarding',
    'status_rejected_on_hold',
  ].includes(value),
);
