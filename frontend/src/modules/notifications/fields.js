export const NOTIFICATION_COLUMNS = [
  { key: 'subject', label: 'Candidate / Employee' },
  { key: 'type', label: 'Notification Type' },
  { key: 'dueAt', label: 'Due At' },
  { key: 'sendAt', label: 'Send At' },
  { key: 'sentAt', label: 'Sent At' },
  { key: 'status', label: 'Status' },
  { key: 'recipient', label: 'Recipient' },
  { key: 'actions', label: 'Actions' },
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
];
