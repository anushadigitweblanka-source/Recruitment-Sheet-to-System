// Checks and tidies the candidate fields sent by the browser. This is the
// authoritative validation: the form's own checks are only for convenience.

const MAX = {
  candidateCode: 30,
  fullName: 150,
  email: 254,
  address: 500,
  olMaths: 50,
  alResult: 100,
  alStream: 100,
  otherEducation: 1000,
  cvUrl: 2000,
  companyCvUrl: 2000,
  hrComment: 2000,
};

const LABELS = {
  candidateCode: 'Candidate ID',
  fullName: 'Name',
  phone: 'Phone',
  email: 'Email',
  address: 'Address',
  olMaths: 'O/L Maths',
  alResult: 'A/L Result',
  alStream: 'A/L Stream',
  otherEducation: 'Other Education',
  positionId: 'Applied Position',
  sourceId: 'Source',
  cvUrl: 'CV Link',
  companyCvUrl: 'Company CV Link',
  hrComment: 'HR Comment',
};

const EMAIL_SHAPE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const PHONE_SHAPE = /^\+?[0-9]{9,15}$/;

// Removes the spaces, dashes, dots and brackets people type in phone numbers.
// The result stays text, so "077 123 4567" becomes "0771234567", not a number.
export function cleanPhone(value) {
  return String(value).replace(/[\s\-().]/g, '');
}

// The part of a phone number used to spot likely duplicates: its last nine
// digits. "0771234567", "+94771234567" and "771234567" all give "771234567".
export function phoneMatchKey(phone) {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  return digits.length >= 9 ? digits.slice(-9) : null;
}

export function normalizeName(name) {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

function isHttpUrl(value) {
  if (/\s/.test(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

// Returns { values, errors }. `errors` maps a field name to a message and is
// empty when everything is acceptable. Empty text becomes null.
export function validateCandidate(input) {
  const source = input && typeof input === 'object' ? input : {};
  const values = {};
  const errors = {};

  const text = (name, { required = false, singleLine = false } = {}) => {
    const raw = source[name];
    if (raw !== undefined && raw !== null && typeof raw !== 'string') {
      errors[name] = `${LABELS[name]} must be text.`;
      return null;
    }
    const value = (raw ?? '').trim();
    if (!value) {
      if (required) errors[name] = `${LABELS[name]} is required.`;
      return null;
    }
    if (value.length > MAX[name]) {
      errors[name] = `${LABELS[name]} must be at most ${MAX[name]} characters.`;
    } else if (singleLine && /[\r\n\t]/.test(value)) {
      errors[name] = `${LABELS[name]} must be on one line.`;
    }
    return value;
  };

  const lookupId = (name) => {
    const raw = source[name];
    if (raw === undefined || raw === null || raw === '') return null;
    const id = Number(raw);
    if (!Number.isInteger(id) || id < 1) {
      errors[name] = `${LABELS[name]} is not a valid choice.`;
      return null;
    }
    return id;
  };

  values.candidateCode = text('candidateCode', { required: true, singleLine: true });
  values.fullName = text('fullName', { required: true, singleLine: true });

  // Phone: must arrive as text. A number would already have lost its leading 0.
  const rawPhone = source.phone;
  if (rawPhone === undefined || rawPhone === null || rawPhone === '') {
    values.phone = null;
  } else if (typeof rawPhone !== 'string') {
    values.phone = null;
    errors.phone = 'Phone must be sent as text, so a leading 0 is kept.';
  } else {
    const phone = cleanPhone(rawPhone);
    values.phone = phone || null;
    if (phone && !PHONE_SHAPE.test(phone)) {
      errors.phone = 'Phone must be 9 to 15 digits, with an optional + at the start.';
    }
  }

  const email = text('email', { singleLine: true });
  values.email = email ? email.toLowerCase() : null;
  if (email && !errors.email && !EMAIL_SHAPE.test(email)) {
    errors.email = 'Email is not a valid address.';
  }

  values.address = text('address');
  values.olMaths = text('olMaths', { singleLine: true });
  values.alResult = text('alResult', { singleLine: true });
  values.alStream = text('alStream', { singleLine: true });
  values.otherEducation = text('otherEducation');
  values.positionId = lookupId('positionId');
  values.sourceId = lookupId('sourceId');

  for (const name of ['cvUrl', 'companyCvUrl']) {
    values[name] = text(name, { singleLine: true });
    if (values[name] && !errors[name] && !isHttpUrl(values[name])) {
      errors[name] = `${LABELS[name]} must be a web address starting with http:// or https://.`;
    }
  }

  values.hrComment = text('hrComment');

  return { values, errors };
}

const SORTABLE = ['createdAt', 'name', 'candidateCode'];

// Reads the list filters from the query string, falling back to safe defaults
// for anything missing or malformed.
export function parseListQuery(query) {
  const positiveInt = (raw) => {
    const n = Number(raw);
    return Number.isInteger(n) && n > 0 ? n : null;
  };
  const search = typeof query.search === 'string' ? query.search.trim().slice(0, 100) : '';

  return {
    search: search || null,
    positionId: positiveInt(query.positionId),
    sourceId: positiveInt(query.sourceId),
    stage:
      typeof query.stage === 'string' && /^[a-z][a-z0-9_]*$/.test(query.stage) ? query.stage : null,
    page: positiveInt(query.page) ?? 1,
    pageSize: Math.min(positiveInt(query.pageSize) ?? 20, 100),
    sort: SORTABLE.includes(query.sort) ? query.sort : 'createdAt',
    order: query.order === 'asc' ? 'asc' : 'desc',
  };
}
