// The WhatsApp / SMS text the task guide asks for next to each mail: "Also
// offer a WhatsApp/SMS text with the same details, because the sheet already
// tracks Normal Message and WhatsApp Message."
//
// It is text for HR to read and copy. Nothing here sends anything, there is
// no messaging provider, and nothing is logged as sent. The text is built only
// from the same safe values the mail placeholders use (name, position, date,
// time, venue); it cannot contain a salary, a password, an upload link or any
// credential, because none of those values is ever read.
//
// The wording below is development wording. The guide gives the details a
// message carries, not the sentences, so HR confirms the final text.

import { formatDate, formatTime } from './emailTypes.js';
import { loadMailContext, readMailSettings } from './mailContext.js';

export const MESSAGE_TYPES = ['interview_invitation', 'joining_onboarding'];

const clean = (value) =>
  String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();

function interviewText({ name, position, date, time, venue }) {
  const role = position ? ` for the ${position} position` : '';
  const place = venue ? ` at ${venue}` : '';
  return `Hello ${name}, you are invited to a direct interview${role} on ${date} at ${time}${place}. Please reply to confirm. Thank you.`;
}

function joiningText({ name, position, date, venue }) {
  const role = position ? ` as ${position}` : '';
  const place = venue ? ` at ${venue}` : '';
  return `Hello ${name}, we are pleased to confirm your joining${role} on ${date}${place}. Please reply to confirm. We look forward to seeing you.`;
}

// Same checks as the mail of the same type, with the phone number in place of
// the email address.
function missingFor(type, context) {
  const missing = [];
  if (!context.phone) missing.push('candidate phone number');
  if (type === 'interview_invitation') {
    if (!context.interviewAt) missing.push('interview date and time');
  } else if (!context.onboardingDate) {
    missing.push('joining date');
  }
  return missing;
}

// Said when an invitation cannot be prepared, so HR knows the step to take
// rather than only what is empty.
const NO_INTERVIEW_HINT =
  'No interview has been scheduled for this candidate yet. Record the phone interview as Selected with an interview date and time first, then preview the invitation again.';

export async function previewMessage(db, { candidateId, type }) {
  if (!MESSAGE_TYPES.includes(type)) {
    return {
      ok: false,
      reason: 'validation',
      fields: { type: `Message type must be one of: ${MESSAGE_TYPES.join(', ')}.` },
    };
  }
  const context = await loadMailContext(db, candidateId);
  if (!context) return { ok: false, reason: 'not_found' };

  const settings = await readMailSettings(db);
  const missing = missingFor(type, context);
  const joining = type === 'joining_onboarding';

  let text = '';
  if (missing.length === 0) {
    const values = {
      name: clean(context.fullName),
      position: clean(context.positionName),
      date: joining ? formatDate(context.onboardingDate) : formatDate(context.interviewAt),
      time: joining ? '' : formatTime(context.interviewAt),
      venue: clean(joining ? (context.offerLocation ?? settings.venue) : settings.venue),
    };
    text = joining ? joiningText(values) : interviewText(values);
  }

  return {
    ok: true,
    data: {
      type,
      channel: 'whatsapp_sms',
      to: context.phone ?? null,
      text,
      missing,
      canCopy: missing.length === 0,
      hint: type === 'interview_invitation' && !context.interviewAt ? NO_INTERVIEW_HINT : null,
      note: 'Nothing is sent from here. Copy the text and send it yourself.',
    },
  };
}
