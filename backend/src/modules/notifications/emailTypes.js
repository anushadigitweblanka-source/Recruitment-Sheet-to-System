// The mail types and send modes defined by the task guide (section on email
// automation). This list is the whole set of template types: no other type
// can be created. Each type fixes which send modes are allowed.
//
//   Auto       the system sends when the triggering event happens
//   One-click  HR previews the mail and presses one button
//
// Where the guide says "Auto or One-click" both are allowed and the choice is
// the template's send_mode, editable without a code change.

export const TEMPLATE_TYPES = {
  // Direct interview invitation: Auto or One-click.
  interview_invitation: { sendModes: ['auto', 'one_click'], manual: true },
  // Team Lead candidate summary / interview slot: Auto or One-click.
  team_lead_summary: { sendModes: ['auto', 'one_click'], manual: true },
  // Joining / onboarding mail: One-click.
  joining_onboarding: { sendModes: ['one_click'], manual: true },
  // Interview reminder, 24 hours before: Auto.
  interview_reminder: { sendModes: ['auto'], manual: false },
  // Joining reminder, 24 hours before: Auto.
  joining_reminder: { sendModes: ['auto'], manual: false },
  // Evaluation / Probation / Junior ending reminder: Auto.
  phase_end_reminder: { sendModes: ['auto'], manual: false },
  // Rejected / On Hold status mail: One-click, optional.
  status_rejected_on_hold: { sendModes: ['one_click'], manual: true },
  // The reminder to a candidate whose Company CV has not arrived 24 hours
  // before the interview. The guide describes this reminder but names no
  // separate template for it - STILL_REQUIRES_CONFIRMATION.
  cv_pending_reminder: { sendModes: ['auto'], manual: false },
};

export const TEMPLATE_TYPE_NAMES = Object.keys(TEMPLATE_TYPES);
export const SEND_MODES = ['auto', 'one_click'];

// The mail a scheduled notification is sent with. The three phase reminders
// share the guide's single "phase-end reminder" mail.
const TEMPLATE_FOR_NOTIFICATION = {
  evaluation_end: 'phase_end_reminder',
  probation_end: 'phase_end_reminder',
  junior_end: 'phase_end_reminder',
  interview_reminder: 'interview_reminder',
  joining_reminder: 'joining_reminder',
  cv_pending: 'cv_pending_reminder',
};

export const templateTypeFor = (notificationType) => TEMPLATE_FOR_NOTIFICATION[notificationType];

// The only placeholders a template may use. Anything else (a salary, a
// password, a credential) is never substituted, so it can never reach a mail.
export const PLACEHOLDERS = ['name', 'position', 'date', 'time', 'venue', 'team_lead'];
// Extra placeholders of the interview invitation, which carries the Company
// CV template and the candidate's own upload link (also used by the CV
// reminder, which repeats the link).
export const COMPANY_CV_PLACEHOLDERS = ['company_cv_template', 'company_cv_upload_link'];

export function renderTemplate(text, values) {
  let out = text;
  for (const [key, value] of Object.entries(values)) {
    out = out.replaceAll(`{${key}}`, value ?? '');
  }
  return out;
}

const DATE_FORMAT = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Colombo',
  day: '2-digit',
  month: 'short',
  year: 'numeric',
});
const TIME_FORMAT = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Colombo',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

export const formatDate = (value) => (value ? DATE_FORMAT.format(new Date(value)) : '');
export const formatTime = (value) => (value ? TIME_FORMAT.format(new Date(value)) : '');
