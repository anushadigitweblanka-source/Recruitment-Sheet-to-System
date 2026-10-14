// Reads the report filters from the query string, falling back to safe
// defaults for anything missing or malformed. All reports are read-only, so a
// bad filter can never do harm - it is simply ignored.

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const STAGE_CODE = /^[a-z][a-z0-9_]*$/;

const positiveInt = (raw) => {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
};

const isoDate = (raw) => (typeof raw === 'string' && ISO_DATE.test(raw) ? raw : null);

export function parseStatusQuery(query) {
  return {
    stage: typeof query.stage === 'string' && STAGE_CODE.test(query.stage) ? query.stage : null,
    positionId: positiveInt(query.positionId),
    sourceId: positiveInt(query.sourceId),
    from: isoDate(query.from),
    to: isoDate(query.to),
    page: positiveInt(query.page) ?? 1,
    pageSize: Math.min(positiveInt(query.pageSize) ?? 20, 100),
  };
}

export function parseRangeQuery(query) {
  return { from: isoDate(query.from), to: isoDate(query.to) };
}

// The office week runs Monday to Sunday in Asia/Colombo. The default week is
// the last completed one; `weekStart` (a Monday) selects another.
const COLOMBO_DAY = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Colombo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
const COLOMBO_WEEKDAY = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Colombo',
  weekday: 'short',
});

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const addDays = (isoText, days) => {
  const date = new Date(`${isoText}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

export const isMonday = (isoText) =>
  WEEKDAYS.indexOf(COLOMBO_WEEKDAY.format(new Date(`${isoText}T12:00:00+05:30`))) === 0;

// The Monday of the last completed Monday-to-Sunday week, as a date text.
export function previousWeekStart(now = new Date()) {
  const today = COLOMBO_DAY.format(now); // YYYY-MM-DD in Asia/Colombo
  const weekdayIndex = WEEKDAYS.indexOf(COLOMBO_WEEKDAY.format(now));
  const thisMonday = addDays(today, -weekdayIndex);
  return addDays(thisMonday, -7);
}

export function parseWeeklyQuery(query, now = new Date()) {
  const requested = isoDate(query.weekStart);
  const weekStart = requested && isMonday(requested) ? requested : previousWeekStart(now);
  return { weekStart, weekEnd: addDays(weekStart, 6) };
}
