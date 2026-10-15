// Checks the employee fields and gate decisions sent by the browser. This is
// the authoritative validation; the forms' own checks are only for convenience.

import { isRealDate } from './lifecycleDates.js';

export const PHASES = ['evaluation', 'probation', 'junior', 'senior'];
export const TRACKS = ['intern', 'staff'];
export const STATUSES = ['active', 'discontinued', 'terminated'];

// The gate decisions the task guide allows for each phase. Senior has none.
export const RESULTS_BY_PHASE = {
  evaluation: ['pass', 'discontinue'],
  probation: ['pass', 'extend', 'discontinue'],
  junior: ['pass', 'discontinue'],
  senior: [],
};

// Termination is "employment ended by the company after confirmation": the
// guide's working definition, after probation has passed.
export const PHASES_THAT_CAN_TERMINATE = ['junior', 'senior'];

const MAX_REASON = 1000;
const MAX_URL = 500;

const isBlank = (value) => value === undefined || value === null || value === '';

function optionalText(source, name, label, max, errors) {
  const raw = source[name];
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'string') {
    errors[name] = `${label} must be text.`;
    return null;
  }
  const value = raw.trim();
  if (value.length > max) errors[name] = `${label} must be at most ${max} characters.`;
  return value || null;
}

function requiredDate(source, name, label, errors) {
  if (isBlank(source[name])) {
    errors[name] = `${label} is required.`;
    return null;
  }
  if (!isRealDate(source[name])) {
    errors[name] = `${label} is not a valid date.`;
    return null;
  }
  return source[name];
}

export function validateTrack(input) {
  const source = input && typeof input === 'object' ? input : {};
  const errors = {};
  let track = null;
  if (!isBlank(source.track)) {
    if (TRACKS.includes(source.track)) track = source.track;
    else errors.track = 'Track must be Intern or Staff.';
  }
  return { track, errors };
}

// Checks a gate decision against the open phase.
//   phase:            the open phase row
//   joinDate:         the employee's join date
//   extensionLatest:  the latest end date a probation extension may have
// Returns { values, errors }.
export function validateDecision(input, { phase, joinDate, extensionLatest }) {
  const source = input && typeof input === 'object' ? input : {};
  const errors = {};
  const allowed = RESULTS_BY_PHASE[phase.phase];
  const values = { result: null, reason: null, reviewDocUrl: null, endDate: null, exitDate: null };

  if (allowed.length === 0) {
    errors.result = 'The senior phase has no gate decision.';
    return { values, errors };
  }
  if (isBlank(source.result)) {
    errors.result = 'Choose a decision.';
  } else if (!allowed.includes(source.result)) {
    errors.result = `The ${phase.phase} phase can only end in: ${allowed.join(', ')}.`;
  } else {
    values.result = source.result;
  }

  values.reason = optionalText(source, 'reason', 'Reason', MAX_REASON, errors);
  const url = optionalText(source, 'reviewDocUrl', 'Review document link', MAX_URL, errors);
  if (url && !/^https?:\/\/\S+$/.test(url)) {
    errors.reviewDocUrl = 'Review document link must start with http:// or https://.';
  } else {
    values.reviewDocUrl = url;
  }

  if (values.result === 'discontinue') {
    // "Status = Discontinued; reason required".
    if (!values.reason && !errors.reason) errors.reason = 'A reason is required to discontinue.';
    values.exitDate = requiredDate(source, 'exitDate', 'Exit date', errors);
    if (values.exitDate && values.exitDate < joinDate) {
      errors.exitDate = 'Exit date cannot be before the join date.';
    }
  }

  // A junior phase that has no stored end date (created before the date was
  // calculated) needs the date it actually ended; the senior phase starts the
  // next day. A stored end date is used as it is.
  if (values.result === 'pass' && phase.phase === 'junior' && !phase.endDate) {
    values.endDate = requiredDate(source, 'endDate', 'Junior end date', errors);
    if (values.endDate && values.endDate < phase.startDate) {
      errors.endDate = 'Junior end date cannot be before the junior phase started.';
    }
  }

  // "Extend (max 1 month)": the extension runs from the day after the current
  // end date, and may not go beyond one month after the original probation.
  if (values.result === 'extend') {
    values.endDate = requiredDate(source, 'endDate', 'Extended end date', errors);
    if (values.endDate && values.endDate <= phase.endDate) {
      errors.endDate = 'Extended end date must be after the current end date.';
    } else if (values.endDate && values.endDate > extensionLatest) {
      errors.endDate = `Probation can be extended to ${extensionLatest} at the latest.`;
    }
  }

  return { values, errors };
}

export function validateTermination(input, { joinDate }) {
  const source = input && typeof input === 'object' ? input : {};
  const errors = {};
  const reason = optionalText(source, 'reason', 'Reason', MAX_REASON, errors);
  if (!reason && !errors.reason) errors.reason = 'A reason is required.';
  const exitDate = requiredDate(source, 'exitDate', 'Exit date', errors);
  if (exitDate && exitDate < joinDate)
    errors.exitDate = 'Exit date cannot be before the join date.';
  return { values: { reason, exitDate }, errors };
}

// Reads the list filters from the query string, with safe defaults.
export function parseListQuery(query) {
  const positiveInt = (raw) => {
    const n = Number(raw);
    return Number.isInteger(n) && n > 0 ? n : null;
  };
  const search = typeof query.search === 'string' ? query.search.trim().slice(0, 100) : '';

  return {
    search: search || null,
    phase: PHASES.includes(query.phase) ? query.phase : null,
    // "none" means no track set yet.
    track: [...TRACKS, 'none'].includes(query.track) ? query.track : null,
    // "exited" means discontinued or terminated.
    status: [...STATUSES, 'exited'].includes(query.status) ? query.status : null,
    reviewFrom: isRealDate(query.reviewFrom) ? query.reviewFrom : null,
    reviewTo: isRealDate(query.reviewTo) ? query.reviewTo : null,
    page: positiveInt(query.page) ?? 1,
    pageSize: Math.min(positiveInt(query.pageSize) ?? 20, 100),
  };
}
