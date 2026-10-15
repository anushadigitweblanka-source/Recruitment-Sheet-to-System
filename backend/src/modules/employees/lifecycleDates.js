// Phase date calculations from the task guide, section 3. Dates are
// "YYYY-MM-DD" text and are worked on in UTC, so a date never shifts with the
// time zone of the server.
//
//   7-Day Evaluation  starts join_date            ends join_date + 6 days
//   Probation         starts evaluation_end + 1   ends EDATE(start, 3) - 1 day
//   Junior            starts probation_end + 1    ends EDATE(start, junior_months) - 1 day
//   Senior            starts junior_end + 1       no end date
//
// The junior end is counted from the junior start (the guide's worked example).
// That reading is the project owner's implementation decision, not an HR
// sign-off; the duration is the editable junior_months setting.

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

// ---------------------------------------------------------------------------
// The two readings of "9 months junior" (guide, section 3). The application
// uses `after_probation` (the project owner's decision; it reproduces the
// guide's worked example). `from_joining` is kept and tested but NOT used.
//
//   after_probation  the 9 months start with junior: EDATE(junior_start, 9) - 1
//                    (the guide's worked example: 9 Feb 2027 - 8 Nov 2027)
//   from_joining     the 9 months start at the join date: EDATE(join_date, 9) - 1
//                    (junior is then about 6 months after probation)
//
// A from_joining end that is not after the junior start is not a usable end
// date, so it is reported as null instead of being invented.
// ---------------------------------------------------------------------------

export const JUNIOR_BASES = ['after_probation', 'from_joining'];

export function juniorPhaseEnd({ juniorStart, joinDate, months, basis }) {
  if (basis === 'after_probation') return monthsPhaseEnd(juniorStart, months);
  if (basis === 'from_joining') {
    const end = monthsPhaseEnd(joinDate, months);
    return end >= juniorStart ? end : null;
  }
  throw new Error(`Unknown junior basis "${basis}". Expected one of: ${JUNIOR_BASES.join(', ')}.`);
}
