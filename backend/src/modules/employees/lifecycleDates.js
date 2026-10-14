// Phase date calculations from the task guide, section 3. Dates are
// "YYYY-MM-DD" text and are worked on in UTC, so a date never shifts with the
// time zone of the server.
//
//   7-Day Evaluation  starts join_date            ends join_date + 6 days
//   Probation         starts evaluation_end + 1   ends EDATE(start, 3) - 1 day
//   Junior            starts probation_end + 1    end not calculated (see below)
//   Senior            starts junior_end + 1       no end date
//
// The junior end date is deliberately not calculated: whether its 9 months
// count from the end of probation or from the join date is not confirmed.

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const toDate = (text) => new Date(`${text}T00:00:00Z`);
const toText = (date) => date.toISOString().slice(0, 10);

// A real calendar date in YYYY-MM-DD form (so "2026-02-30" is refused).
export function isRealDate(text) {
  if (typeof text !== 'string' || !ISO_DATE.test(text)) return false;
  const date = toDate(text);
  return !Number.isNaN(date.getTime()) && toText(date) === text;
}

export function addDays(text, days) {
  const date = toDate(text);
  date.setUTCDate(date.getUTCDate() + days);
  return toText(date);
}

// The spreadsheet EDATE: the same day `months` later, or the last day of that
// month when it is shorter (31 Jan + 1 month = 28 Feb).
export function addMonths(text, months) {
  const date = toDate(text);
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(date.getUTCDate(), lastDay));
  return toText(target);
}

export const evaluationEnd = (joinDate, evaluationDays) => addDays(joinDate, evaluationDays - 1);

// The day after one phase ends is the first day of the next.
export const nextPhaseStart = (endDate) => addDays(endDate, 1);

// EDATE(start, months) - 1 day.
export const monthsPhaseEnd = (startDate, months) => addDays(addMonths(startDate, months), -1);
