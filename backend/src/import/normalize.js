// Normalization for workbook values. Every function returns
// { value, issue } - value is the normalized value or null, issue is an
// issue code (plus detail) or null. Nothing here guesses: a value that
// cannot be normalized with certainty keeps its issue and goes to review.
//
// Phone and name rules are the ones the application already implements in
// candidates.validation.js, reused so manual entry and import agree.

import { cleanPhone } from '../modules/candidates/candidates.validation.js';
import { MAX_SCORE, MIN_SCORE } from '../modules/interviews/interviews.validation.js';

const EMAIL_SHAPE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const PHONE_SHAPE = /^\+?[0-9]{9,15}$/;

const ok = (value) => ({ value, issue: null });
const review = (code, detail) => ({ value: null, issue: { code, detail } });

export const isBlank = (raw) =>
  raw === undefined || raw === null || (typeof raw === 'string' && raw.trim() === '');

// Plain text: trimmed, optionally single-line, blank becomes null (no issue).
export function normalizeText(raw, { singleLine = false, maxLength = 2000 } = {}) {
  if (isBlank(raw)) return ok(null);
  const value = String(raw).trim();
  if (value.length > maxLength) {
    return review('invalid_text', `longer than ${maxLength} characters`);
  }
  if (singleLine && /[\r\n\t]/.test(value)) return ok(value.replace(/[\r\n\t]+/g, ' ').trim());
  return ok(value);
}

// Candidate ID: the original ID is preserved exactly as text. A missing ID is
// never invented. The ID format itself is unconfirmed (mentor decision 11),
// so no format check is applied here beyond "not blank".
export function normalizeCandidateId(raw) {
  if (isBlank(raw)) return review('missing_required_field', 'Candidate ID is empty');
  return ok(String(raw).trim());
}

// Phone: output is always a string. A phone that arrived as an Excel NUMBER
// has already lost its leading zero; the restore rule ("add one leading 0")
// is NOT confirmed, so such values go to review instead of being repaired.
export function normalizePhone(raw) {
  if (isBlank(raw)) return ok(null);
  if (typeof raw === 'number') {
    return review(
      'invalid_phone',
      'stored as a number in the workbook; the leading zero is lost and the restore rule is unconfirmed',
    );
  }
  const phone = cleanPhone(String(raw));
  if (!PHONE_SHAPE.test(phone)) {
    return review('invalid_phone', 'not 9 to 15 digits with an optional leading +');
  }
  return ok(phone);
}

export function normalizeEmail(raw) {
  if (isBlank(raw)) return ok(null);
  const email = String(raw).trim().toLowerCase();
  if (!EMAIL_SHAPE.test(email)) return review('invalid_email', 'not a valid address shape');
  return ok(email);
}

const pad = (n) => String(n).padStart(2, '0');
const toIsoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// Dates: a true Excel date cell arrives as a JS Date and is trusted. A text
// date is accepted only in the unambiguous ISO form YYYY-MM-DD. Anything
// else (03/04/2025, 13-04-25, free text) is ambiguous or malformed and goes
// to review. No date is ever guessed or defaulted.
export function normalizeDate(raw) {
  if (isBlank(raw)) return ok(null);
  if (raw instanceof Date) {
    if (Number.isNaN(raw.getTime())) return review('invalid_date', 'unreadable date cell');
    return ok(toIsoDate(raw));
  }
  if (typeof raw === 'string') {
    const text = raw.trim();
    const isoMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
    if (isoMatch) {
      const parsed = new Date(`${text}T00:00:00Z`);
      if (!Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(text)) return ok(text);
      return review('invalid_date', 'not a real calendar date');
    }
    if (/^\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}$/.test(text)) {
      return review('invalid_date', 'day/month order is ambiguous; format must be confirmed');
    }
    return review('invalid_date', 'unrecognized date text');
  }
  return review('invalid_date', 'not a date cell or date text');
}

// Date-times (interview slots): a Date cell is trusted; text must carry an
// explicit timezone offset (wall-clock times are Asia/Colombo, +05:30), so
// the stored moment is unambiguous.
export function normalizeDateTime(raw) {
  if (isBlank(raw)) return ok(null);
  if (raw instanceof Date) {
    if (Number.isNaN(raw.getTime())) return review('invalid_date', 'unreadable date-time cell');
    return ok(raw.toISOString());
  }
  if (typeof raw === 'string') {
    const text = raw.trim();
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?([+-]\d{2}:\d{2}|Z)$/.test(text)) {
      const parsed = new Date(text);
      if (!Number.isNaN(parsed.getTime())) return ok(parsed.toISOString());
    }
    return review('invalid_date', 'date-time text must include an explicit timezone offset');
  }
  return review('invalid_date', 'not a date-time cell or ISO text');
}

// One interview score: a whole number from 0 to 10. The total out of 50 is
// never imported - the database calculates it.
export function normalizeScore(raw) {
  if (isBlank(raw)) return ok(null);
  const n = typeof raw === 'number' ? raw : Number(String(raw).trim());
  if (!Number.isInteger(n) || n < MIN_SCORE || n > MAX_SCORE) {
    return review('invalid_score', `must be a whole number from ${MIN_SCORE} to ${MAX_SCORE}`);
  }
  return ok(n);
}

// A boolean-ish workbook cell (Called, Attended ticks). Only unmistakable
// values are accepted; anything else goes to review.
const TRUE_WORDS = new Set(['yes', 'y', 'true', '1', 'x', '✓']);
const FALSE_WORDS = new Set(['no', 'n', 'false', '0', '']);
export function normalizeBoolean(raw, issueCode = 'unknown_status') {
  if (isBlank(raw)) return ok(null);
  if (typeof raw === 'boolean') return ok(raw);
  const word = String(raw).trim().toLowerCase();
  if (TRUE_WORDS.has(word)) return ok(true);
  if (FALSE_WORDS.has(word)) return ok(false);
  return review(issueCode, `"${word}" is not a recognized yes/no value`);
}

// A controlled value resolved through an approved mapping ({ sourceWord ->
// targetValue }, compared case-insensitively). The mappings live in
// data-maps/status-value-mapping.md and are passed in once approved; with no
// approved mapping every value goes to review - never silently normalized.
export function resolveLookup(raw, approvedMap, issueCode) {
  if (isBlank(raw)) return ok(null);
  const word = String(raw).trim();
  const target = approvedMap?.[word.toLowerCase()];
  if (target === undefined) return review(issueCode, `"${word}" has no approved mapping`);
  return ok(target);
}
