// Checks the direct interview fields sent by the browser. This is the
// authoritative validation; the form's own checks are only for convenience.

export const ATTENDANCE = ['attended', 'not_attended'];
export const DECISIONS = ['selected', 'not_selected', 'on_hold'];

// The five scores named in the task guide.
export const SCORE_FIELDS = [
  ['scoreTechnical', 'Technical'],
  ['scoreAi', 'AI'],
  ['scoreCommunication', 'Communication'],
  ['scoreConfidence', 'Confidence'],
  ['scoreCultureFit', 'Culture Fit'],
];
export const MIN_SCORE = 0;
export const MAX_SCORE = 10;

const MAX_INTERVIEWER = 150;
const MAX_REMARKS = 2000;
const MAX_REASON = 500;

// A date and time must say which time zone it is in, for example
// "2026-11-02T10:00:00+05:30", so it means the same moment everywhere.
const ISO_WITH_ZONE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

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

function oneOf(source, name, allowed, message, errors) {
  if (isBlank(source[name])) return null;
  if (!allowed.includes(source[name])) {
    errors[name] = message;
    return null;
  }
  return source[name];
}

// A real calendar date in YYYY-MM-DD form (so "2026-02-30" is refused).
function isRealDate(text) {
  if (typeof text !== 'string' || !ISO_DATE.test(text)) return false;
  const date = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === text;
}

// Returns { values, reasons, errors }.
//   values:  what is stored on the interview
//   reasons: what is stored with the candidate's pipeline status
export function validateInterview(input) {
  const source = input && typeof input === 'object' ? input : {};
  const errors = {};
  const values = {};

  values.scheduledAt = null;
  if (isBlank(source.scheduledAt)) {
    errors.scheduledAt = 'Interview Date/Time is required.';
  } else if (
    typeof source.scheduledAt !== 'string' ||
    !ISO_WITH_ZONE.test(source.scheduledAt) ||
    Number.isNaN(Date.parse(source.scheduledAt))
  ) {
    errors.scheduledAt = 'Interview Date/Time is not a valid date and time.';
  } else {
    values.scheduledAt = new Date(source.scheduledAt).toISOString();
  }

  values.attendance = oneOf(
    source,
    'attendance',
    ATTENDANCE,
    'Attendance must be Attended or Not Attended.',
    errors,
  );
  values.interviewerName = optionalText(
    source,
    'interviewerName',
    'Interviewer',
    MAX_INTERVIEWER,
    errors,
  );

  // Scores must be whole numbers. Text such as "7" is refused, so a typing
  // slip in another program cannot turn into a wrong score silently.
  let scoresGiven = 0;
  for (const [name, label] of SCORE_FIELDS) {
    const raw = source[name];
    values[name] = null;
    if (isBlank(raw)) continue;
    if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < MIN_SCORE || raw > MAX_SCORE) {
      errors[name] = `${label} must be a whole number from ${MIN_SCORE} to ${MAX_SCORE}.`;
    } else {
      values[name] = raw;
    }
    scoresGiven += 1;
  }
  const scoresComplete = scoresGiven === SCORE_FIELDS.length;
  if (scoresGiven > 0 && !scoresComplete) {
    for (const [name, label] of SCORE_FIELDS) {
      if (isBlank(source[name]))
        errors[name] = `${label} is missing. Enter all five scores or none.`;
    }
  }

  // The list of allowed Recommendation values has not been approved, so no
  // value is accepted yet.
  values.recommendation = null;
  if (!isBlank(source.recommendation)) {
    errors.recommendation =
      'Recommendation values have not been approved yet, so none can be saved.';
  }

  values.decision = oneOf(
    source,
    'decision',
    DECISIONS,
    'Status must be Selected, Not Selected or On Hold.',
    errors,
  );
  values.remarks = optionalText(source, 'remarks', 'Remarks', MAX_REMARKS, errors);

  // A candidate who did not attend cannot be scored or decided on.
  if (values.attendance === 'not_attended') {
    if (scoresGiven > 0) {
      for (const [name] of SCORE_FIELDS) {
        if (!isBlank(source[name]))
          errors[name] = 'Scores cannot be entered for a candidate who did not attend.';
      }
    }
    if (values.decision)
      errors.decision = 'A candidate who did not attend cannot be given a status here.';
  } else if (values.decision) {
    // "HR/interviewer enters the scores and picks the decision."
    if (values.attendance !== 'attended') {
      errors.attendance = 'Mark the candidate as Attended before choosing a status.';
    }
    if (!scoresComplete && scoresGiven === 0) {
      errors.decision = 'Enter all five scores before choosing a status.';
    }
  }

  // Reasons live with the candidate's pipeline status. Each is required for
  // its own decision and ignored for the others.
  const reasons = { holdReason: null, rejectReason: null, nextFollowupDate: null };
  const holdReason = optionalText(source, 'holdReason', 'Reason for hold', MAX_REASON, errors);
  const rejectReason = optionalText(
    source,
    'rejectReason',
    'Reason for rejection',
    MAX_REASON,
    errors,
  );

  if (values.decision === 'on_hold') {
    reasons.holdReason = holdReason;
    if (!holdReason && !errors.holdReason) {
      errors.holdReason = 'A reason for hold is required when the status is On Hold.';
    }
    if (!isBlank(source.nextFollowupDate)) {
      if (isRealDate(source.nextFollowupDate)) reasons.nextFollowupDate = source.nextFollowupDate;
      else errors.nextFollowupDate = 'Next follow-up date is not a valid date.';
    }
  } else {
    delete errors.holdReason;
  }

  if (values.decision === 'not_selected') {
    reasons.rejectReason = rejectReason;
    if (!rejectReason && !errors.rejectReason) {
      errors.rejectReason = 'A reason for rejection is required when the status is Not Selected.';
    }
  } else {
    delete errors.rejectReason;
  }

  return { values, reasons, errors };
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
    // "pending" means not recorded yet.
    attendance: [...ATTENDANCE, 'pending'].includes(query.attendance) ? query.attendance : null,
    decision: [...DECISIONS, 'pending'].includes(query.decision) ? query.decision : null,
    page: positiveInt(query.page) ?? 1,
    pageSize: Math.min(positiveInt(query.pageSize) ?? 20, 100),
  };
}
