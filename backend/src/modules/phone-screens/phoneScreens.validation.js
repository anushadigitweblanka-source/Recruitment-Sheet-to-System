// Checks the phone interview fields sent by the browser. This is the
// authoritative validation; the form's own checks are only for convenience.

export const RESULTS = ['selected', 'not_selected'];

const MAX_REVIEW = 2000;
const MAX_REJECT_REASON = 500;

// A date and time must say which time zone it is in, for example
// "2026-11-02T10:00:00+05:30", so it means the same moment everywhere.
const ISO_WITH_ZONE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

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

// Returns { values, rejectReason, errors }.
export function validatePhoneScreen(input) {
  const source = input && typeof input === 'object' ? input : {};
  const errors = {};
  const values = {};

  if (source.called === undefined || source.called === null) {
    values.called = false;
  } else if (typeof source.called !== 'boolean') {
    values.called = false;
    errors.called = 'Called must be yes or no.';
  } else {
    values.called = source.called;
  }

  // The list of allowed Response values has not been approved, so no value is
  // accepted yet. This stops unapproved wording being saved into a closed list.
  values.response = null;
  if (source.response !== undefined && source.response !== null && source.response !== '') {
    errors.response = 'Response values have not been approved yet, so none can be saved.';
  }

  if (source.result === undefined || source.result === null || source.result === '') {
    values.result = null;
  } else if (!RESULTS.includes(source.result)) {
    values.result = null;
    errors.result = 'Result must be Selected or Not Selected.';
  } else {
    values.result = source.result;
  }

  values.review = optionalText(source, 'review', 'Review', MAX_REVIEW, errors);

  const rawDate = source.interviewAt;
  values.interviewAt = null;
  if (rawDate !== undefined && rawDate !== null && rawDate !== '') {
    if (
      typeof rawDate !== 'string' ||
      !ISO_WITH_ZONE.test(rawDate) ||
      Number.isNaN(Date.parse(rawDate))
    ) {
      errors.interviewAt = 'Interview Date/Time is not a valid date and time.';
    } else if (values.result !== 'selected') {
      errors.interviewAt = 'An interview date can only be set when the result is Selected.';
    } else {
      values.interviewAt = new Date(rawDate).toISOString();
    }
  }

  // The reason is kept with the candidate's pipeline status, not on the phone
  // interview. It is required for Not Selected and ignored otherwise.
  let rejectReason = optionalText(
    source,
    'rejectReason',
    'Reason for rejection',
    MAX_REJECT_REASON,
    errors,
  );
  if (values.result === 'not_selected') {
    if (!rejectReason && !errors.rejectReason) {
      errors.rejectReason = 'A reason for rejection is required when the result is Not Selected.';
    }
  } else {
    rejectReason = null;
    delete errors.rejectReason;
  }

  return { values, rejectReason, errors };
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
    // "pending" means no result has been recorded yet.
    result: [...RESULTS, 'pending'].includes(query.result) ? query.result : null,
    called: query.called === 'yes' ? true : query.called === 'no' ? false : null,
    page: positiveInt(query.page) ?? 1,
    pageSize: Math.min(positiveInt(query.pageSize) ?? 20, 100),
  };
}
