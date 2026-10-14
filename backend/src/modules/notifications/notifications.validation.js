// Checks for Module 6. This is the authoritative validation; the form's own
// checks are only for convenience.

// The six reminder types from the schema proposal (section 12.2).
export const NOTIFICATION_TYPES = [
  'evaluation_end',
  'probation_end',
  'junior_end',
  'interview_reminder',
  'joining_reminder',
  'cv_pending',
];

export const NOTIFICATION_STATUSES = ['pending', 'sent', 'failed', 'cancelled'];
export const EMAIL_LOG_STATUSES = ['queued', 'sent', 'failed'];
export const SEND_MODES = ['auto', 'review'];

const MAX_TYPE = 50;
const MAX_SUBJECT = 200;
const MAX_BODY = 10000;

const TYPE_FORMAT = /^[a-z][a-z0-9_]*$/;
// A practical shape check: something@something.something, no spaces.
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const isBlank = (value) => value === undefined || value === null || value === '';

export const isEmailAddress = (text) => typeof text === 'string' && EMAIL_SHAPE.test(text);

// Checks a template sent by the browser. With `partial` (a PATCH) only the
// fields that were sent are checked and returned.
export function validateTemplate(input, { partial = false } = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const errors = {};
  const values = {};
  const wants = (name) => !partial || source[name] !== undefined;

  if (wants('type')) {
    const type = typeof source.type === 'string' ? source.type.trim() : '';
    if (!type) errors.type = 'Template Type is required.';
    else if (type.length > MAX_TYPE) {
      errors.type = `Template Type must be at most ${MAX_TYPE} characters.`;
    } else if (!TYPE_FORMAT.test(type)) {
      errors.type =
        'Template Type must be lower-case letters, digits and underscores, like interview_invitation.';
    } else values.type = type;
  }

  if (wants('subject')) {
    const subject = typeof source.subject === 'string' ? source.subject.trim() : '';
    if (!subject) errors.subject = 'Subject is required.';
    else if (subject.length > MAX_SUBJECT) {
      errors.subject = `Subject must be at most ${MAX_SUBJECT} characters.`;
    } else values.subject = subject;
  }

  if (wants('body')) {
    const body = typeof source.body === 'string' ? source.body.trim() : '';
    if (!body) errors.body = 'Body is required.';
    else if (body.length > MAX_BODY) {
      errors.body = `Body must be at most ${MAX_BODY} characters.`;
    } else values.body = body;
  }

  if (wants('sendMode')) {
    if (isBlank(source.sendMode)) {
      if (!partial) values.sendMode = 'review';
    } else if (SEND_MODES.includes(source.sendMode)) values.sendMode = source.sendMode;
    else errors.sendMode = 'Send Mode must be auto or review.';
  }

  if (wants('isActive')) {
    if (isBlank(source.isActive)) {
      if (!partial) values.isActive = true;
    } else if (typeof source.isActive === 'boolean') values.isActive = source.isActive;
    else errors.isActive = 'Active must be true or false.';
  }

  return { values, errors };
}

const positiveInt = (raw) => {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
};

// A calendar-day filter always means an office day (Asia/Colombo), whatever
// zone the server runs in, so a timestamptz comparison needs the day's edge
// written with that offset.
const officeDayStart = (day) => `${day}T00:00:00+05:30`;
const officeDayEnd = (day) => `${day}T23:59:59.999+05:30`;

export function parseNotificationsQuery(query) {
  const search = typeof query.search === 'string' ? query.search.trim().slice(0, 100) : '';
  return {
    search: search || null,
    type: NOTIFICATION_TYPES.includes(query.type) ? query.type : null,
    status: NOTIFICATION_STATUSES.includes(query.status) ? query.status : null,
    // sent=true / sent=false filters on whether sent_at is filled.
    sent: query.sent === 'true' ? true : query.sent === 'false' ? false : null,
    dueFrom: ISO_DATE.test(query.dueFrom) ? officeDayStart(query.dueFrom) : null,
    dueTo: ISO_DATE.test(query.dueTo) ? officeDayEnd(query.dueTo) : null,
    page: positiveInt(query.page) ?? 1,
    pageSize: Math.min(positiveInt(query.pageSize) ?? 20, 100),
  };
}

export function parseEmailLogQuery(query) {
  const recipient = typeof query.recipient === 'string' ? query.recipient.trim().slice(0, 100) : '';
  return {
    recipient: recipient || null,
    status: EMAIL_LOG_STATUSES.includes(query.status) ? query.status : null,
    templateId: positiveInt(query.templateId),
    from: ISO_DATE.test(query.from) ? officeDayStart(query.from) : null,
    to: ISO_DATE.test(query.to) ? officeDayEnd(query.to) : null,
    page: positiveInt(query.page) ?? 1,
    pageSize: Math.min(positiveInt(query.pageSize) ?? 20, 100),
  };
}

export function parseTemplatesQuery(query) {
  return {
    active: query.active === 'true' ? true : query.active === 'false' ? false : null,
  };
}
