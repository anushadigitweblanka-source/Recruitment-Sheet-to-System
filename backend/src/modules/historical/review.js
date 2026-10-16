// Turns the rows of the recruitment interview-log CSV into records that keep
// every original value, plus review flags.
//
// Rules this file keeps, on purpose:
//   - nothing is trimmed, repaired, merged or mapped: a phone number stays the
//     text that was in the file, a status stays the word that was in the file;
//   - no Candidate ID is invented, and no record is ever dropped;
//   - interview_on is filled only for an unambiguous day-first date (the
//     official guide's example is 18/06/2026), and is empty otherwise;
//   - a flag says "a person should look at this", never "this is wrong".

import { createHash } from 'node:crypto';
import { normalizeName, phoneMatchKey } from '../candidates/candidates.validation.js';

export const REVIEW_FLAG_CODES = [
  'name_missing',
  'phone_missing',
  'phone_unusual',
  'phone_shared_different_names',
  'date_missing',
  'date_unrecognised',
  'date_year_unexpected',
  'status_missing',
];

// The headers the file is recognised by, compared without case.
const ALIASES = {
  date: ['date', 'interview date'],
  name: ['name', 'candidate name', 'full name'],
  phone: ['contact #', 'contact no', 'contact', 'contact number', 'phone', 'phone number'],
  source: ['source'],
  mode: ['mode', 'interview mode'],
  position: ['position', 'applied position'],
  status: ['status'],
  remarks: ['remarks', 'remark'],
};
const REQUIRED = ['date', 'name', 'phone'];

// Maps the sheet's headers to field names. The one unnamed column that holds
// values (read as "(blank column N)") is kept as extra_value.
export function mapHeaders(headers) {
  const lower = headers.map((h) => h.toLowerCase());
  const fields = {};
  for (const [field, aliases] of Object.entries(ALIASES)) {
    const at = lower.findIndex((h) => aliases.includes(h));
    if (at !== -1) fields[field] = headers[at];
  }
  const extra = headers.find((h) => /^\(blank column \d+\)$/.test(h)) ?? null;
  const missing = REQUIRED.filter((field) => !fields[field]);
  return { fields, extra, missing };
}

const DAY_FIRST = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/;

// 'YYYY-MM-DD' for an unambiguous day-first date in the expected years, else
// null. Time of day is not read: only the calendar day is derived.
export function interviewOn(text) {
  if (typeof text !== 'string') return null;
  const m = DAY_FIRST.exec(text.trim());
  if (!m) return null;
  const [day, month, year] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (year < 2025 || year > 2026) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    Number.isNaN(date.getTime()) ||
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date.toISOString().slice(0, 10);
}

const isBlank = (v) => v === null || v === undefined || String(v).trim() === '';
const digitsOf = (v) => String(v ?? '').replace(/\D/g, '');

function flagsFor(record) {
  const flags = [];
  if (isBlank(record.candidateName)) flags.push('name_missing');
  if (isBlank(record.contactNumber)) {
    flags.push('phone_missing');
  } else {
    // "Usual" is a ten-digit number starting 0, in one piece. Anything else is
    // flagged and left exactly as it was; it is never repaired.
    const asGiven = String(record.contactNumber).trim();
    if (!/^0\d{9}$/.test(asGiven)) flags.push('phone_unusual');
  }
  if (isBlank(record.interviewDateText)) {
    flags.push('date_missing');
  } else if (!DAY_FIRST.test(String(record.interviewDateText).trim())) {
    flags.push('date_unrecognised');
  } else if (!record.interviewOn) {
    flags.push('date_year_unexpected');
  }
  if (isBlank(record.originalStatus)) flags.push('status_missing');
  return flags;
}

export function rowHash(parts) {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex');
}

// sheet: { headers, rows: [{ rowNumber, values }] } from readCsvSheet.
export function buildRecords(sheet) {
  const { fields, extra, missing } = mapHeaders(sheet.headers);
  if (missing.length > 0) {
    const error = new Error(
      `This is not an interview log file: no header for ${missing.join(', ')}.`,
    );
    error.code = 'not_interview_log';
    throw error;
  }

  const get = (row, field) => {
    const header = field === 'extra' ? extra : fields[field];
    if (!header) return null;
    const value = row.values[header];
    return value === undefined || value === null || String(value).trim() === ''
      ? null
      : String(value);
  };

  const records = sheet.rows.map((row) => {
    const record = {
      recordNumber: row.rowNumber,
      interviewDateText: get(row, 'date'),
      candidateName: get(row, 'name'),
      contactNumber: get(row, 'phone'),
      source: get(row, 'source'),
      mode: get(row, 'mode'),
      position: get(row, 'position'),
      originalStatus: get(row, 'status'),
      remarks: get(row, 'remarks'),
      extraValue: get(row, 'extra'),
    };
    record.interviewOn = interviewOn(record.interviewDateText);
    record.reviewFlags = flagsFor(record);
    record.rowHash = rowHash([
      record.interviewDateText,
      record.candidateName,
      record.contactNumber,
      record.source,
      record.mode,
      record.position,
      record.originalStatus,
      record.remarks,
      record.extraValue,
    ]);
    return record;
  });

  // The same phone number under different names: possibly two people, a shared
  // phone or a typo. Nothing is merged; both rows are flagged.
  const groups = new Map();
  for (const record of records) {
    const digits = digitsOf(record.contactNumber);
    if (digits.length < 8) continue;
    const key = phoneMatchKey(digits);
    groups.set(key, [...(groups.get(key) ?? []), record]);
  }
  for (const group of groups.values()) {
    const names = new Set(group.map((r) => normalizeName(String(r.candidateName ?? ''))));
    if (names.size > 1) {
      for (const record of group) record.reviewFlags.push('phone_shared_different_names');
    }
  }
  return records;
}

// Counts only: nothing that identifies a person.
export function summarize(records) {
  const flagCounts = {};
  for (const record of records) {
    for (const flag of record.reviewFlags) flagCounts[flag] = (flagCounts[flag] ?? 0) + 1;
  }
  const review = records.filter((r) => r.reviewFlags.length > 0).length;
  return {
    records: records.length,
    clean: records.length - review,
    needingReview: review,
    flagCounts,
    withInterviewDate: records.filter((r) => r.interviewOn).length,
  };
}
