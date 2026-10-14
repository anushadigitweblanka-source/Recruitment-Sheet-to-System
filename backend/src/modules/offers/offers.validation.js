// Checks the offer fields sent by the browser. This is the authoritative
// validation; the form's own checks are only for convenience.
//
// Salary functionality pending mentor approval and authorization design.
// No salary field is read, checked or stored here.

// The two values backed by the task guide's stage list.
export const OFFER_STATUSES = ['sent', 'accepted'];

const MAX_LOCATION = 200;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const isBlank = (value) => value === undefined || value === null || value === '';

// A real calendar date in YYYY-MM-DD form (so "2026-02-30" is refused).
function isRealDate(text) {
  if (typeof text !== 'string' || !ISO_DATE.test(text)) return false;
  const date = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === text;
}

function optionalDate(source, name, label, errors) {
  if (isBlank(source[name])) return null;
  if (!isRealDate(source[name])) {
    errors[name] = `${label} is not a valid date.`;
    return null;
  }
  return source[name];
}

// Returns { values, errors }. Whether the position exists is checked by the
// service, which can look it up.
export function validateOffer(input) {
  const source = input && typeof input === 'object' ? input : {};
  const errors = {};
  const values = {};

  values.positionId = null;
  if (isBlank(source.positionId)) {
    errors.positionId = 'Position is required.';
  } else if (!Number.isInteger(source.positionId) || source.positionId < 1) {
    errors.positionId = 'Position must be chosen from the list.';
  } else {
    values.positionId = source.positionId;
  }

  values.offerDate = optionalDate(source, 'offerDate', 'Offer Date', errors);

  // The list of allowed Work Mode values has not been approved, so no value
  // is accepted yet.
  values.workMode = null;
  if (!isBlank(source.workMode)) {
    errors.workMode = 'Work Mode values have not been approved yet, so none can be saved.';
  }

  values.location = null;
  if (source.location !== undefined && source.location !== null) {
    if (typeof source.location !== 'string') {
      errors.location = 'Location must be text.';
    } else {
      const location = source.location.trim();
      if (location.length > MAX_LOCATION) {
        errors.location = `Location must be at most ${MAX_LOCATION} characters.`;
      }
      values.location = location || null;
    }
  }

  values.offerStatus = null;
  if (!isBlank(source.offerStatus)) {
    if (OFFER_STATUSES.includes(source.offerStatus)) values.offerStatus = source.offerStatus;
    else errors.offerStatus = 'Offer Status must be Sent or Accepted.';
  }

  values.onboardingDate = optionalDate(source, 'onboardingDate', 'Onboarding Date', errors);

  // Yes, No or not recorded yet. Text such as "yes" is refused, so a slip in
  // another program cannot turn into a joining silently.
  values.attended = null;
  if (!isBlank(source.attended)) {
    if (typeof source.attended === 'boolean') values.attended = source.attended;
    else errors.attended = 'Attended must be Yes or No.';
  }

  // Attendance is about the joining day of an accepted offer.
  if (values.attended !== null) {
    if (!values.onboardingDate && !errors.onboardingDate) {
      errors.onboardingDate = 'Set the Onboarding Date before recording attendance.';
    }
    if (values.offerStatus !== 'accepted' && !errors.offerStatus) {
      errors.attended = 'Attendance can be recorded once the Offer Status is Accepted.';
    }
  }

  return { values, errors };
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
    // "pending" means no status yet: no offer, or an offer not sent yet.
    offerStatus: [...OFFER_STATUSES, 'pending'].includes(query.offerStatus)
      ? query.offerStatus
      : null,
    onboardingFrom: isRealDate(query.onboardingFrom) ? query.onboardingFrom : null,
    onboardingTo: isRealDate(query.onboardingTo) ? query.onboardingTo : null,
    // Only selected candidates who have no offer yet, for the Create Offer form.
    waitingOnly: query.waiting === 'true',
    page: positiveInt(query.page) ?? 1,
    pageSize: Math.min(positiveInt(query.pageSize) ?? 20, 100),
  };
}
