// Row validation per workbook area, dry-run only: each row is classified as
// READY, REVIEW_REQUIRED or SKIPPED with issue codes. Nothing is written.
//
// "READY" means: every value normalized cleanly, lookups resolved, no
// duplicate risk found. It is a statement about the row, not an action.

import { phoneMatchKey } from '../modules/candidates/candidates.validation.js';
import { findDbDuplicates, matchCandidate } from './matchCandidates.js';
import {
  isBlank,
  normalizeBoolean,
  normalizeCandidateId,
  normalizeDate,
  normalizeDateTime,
  normalizeEmail,
  normalizePhone,
  normalizeScore,
  normalizeText,
  resolveLookup,
} from './normalize.js';

export const READY = 'READY';
export const REVIEW_REQUIRED = 'REVIEW_REQUIRED';
export const SKIPPED = 'SKIPPED';

const take = (issues, normalized) => {
  if (normalized.issue) issues.push(normalized.issue);
  return normalized.value;
};

const finish = (issues) => ({
  status: issues.length === 0 ? READY : REVIEW_REQUIRED,
  issues,
});

// Values arrive keyed by data-map field (already translated from the sheet's
// actual headers). `ctx` carries the read-only db, the lookup maps and the
// in-file duplicate trackers.

export async function validateCandidateRow(values, ctx) {
  const issues = [];

  const candidateId = take(issues, normalizeCandidateId(values.candidateId));
  const fullName = take(
    issues,
    normalizeText(values.fullName, { singleLine: true, maxLength: 150 }),
  );
  if (!fullName) issues.push({ code: 'missing_required_field', detail: 'Name is empty' });
  const phone = take(issues, normalizePhone(values.phone));
  const email = take(issues, normalizeEmail(values.email));
  take(issues, normalizeText(values.address, { maxLength: 500 }));
  take(issues, normalizeText(values.olMaths, { singleLine: true, maxLength: 50 }));
  take(issues, normalizeText(values.alResult, { singleLine: true, maxLength: 100 }));
  take(issues, normalizeText(values.alStream, { singleLine: true, maxLength: 100 }));
  take(issues, normalizeText(values.otherEducation, { maxLength: 1000 }));
  const cvUrl = take(issues, normalizeText(values.cvUrl, { singleLine: true, maxLength: 2000 }));
  take(issues, normalizeText(values.companyCvUrl, { singleLine: true, maxLength: 2000 }));
  take(issues, normalizeText(values.hrComment, { maxLength: 2000 }));

  const positionWord = take(issues, normalizeText(values.position, { singleLine: true }));
  let positionId = null;
  if (positionWord) {
    positionId = take(issues, resolveLookup(positionWord, ctx.positionMap, 'unknown_position'));
  } else {
    issues.push({ code: 'missing_required_field', detail: 'Applied Position is empty' });
  }

  const sourceWord = take(issues, normalizeText(values.source, { singleLine: true }));
  if (sourceWord) take(issues, resolveLookup(sourceWord, ctx.sourceMap, 'unknown_source'));

  const statusWord = take(issues, normalizeText(values.companyCvStatus, { singleLine: true }));
  if (statusWord) {
    take(issues, resolveLookup(statusWord, ctx.statusMaps.companyCvStatus, 'unknown_status'));
  }

  // In-file duplicates: the same workbook must not carry the same candidate
  // twice without review.
  if (candidateId) {
    const firstRow = ctx.seen.candidateIds.get(candidateId);
    if (firstRow) {
      issues.push({
        code: 'duplicate_candidate_id',
        detail: `Candidate ID also appears in this workbook at row ${firstRow}`,
      });
    } else {
      ctx.seen.candidateIds.set(candidateId, ctx.rowNumber);
    }
  }
  const key = phoneMatchKey(phone);
  if (key) {
    const firstRow = ctx.seen.phoneKeys.get(key);
    if (firstRow) {
      issues.push({
        code: 'duplicate_candidate',
        detail: `phone also appears in this workbook at row ${firstRow}`,
      });
    } else {
      ctx.seen.phoneKeys.set(key, ctx.rowNumber);
    }
  }
  if (email) {
    const firstRow = ctx.seen.emails.get(email);
    if (firstRow) {
      issues.push({
        code: 'duplicate_candidate',
        detail: `email also appears in this workbook at row ${firstRow}`,
      });
    } else {
      ctx.seen.emails.set(email, ctx.rowNumber);
    }
  }
  if (cvUrl) {
    const firstRow = ctx.seen.cvUrls.get(cvUrl);
    if (firstRow) {
      issues.push({
        code: 'reused_cv_link',
        detail: `the same CV link also appears at row ${firstRow}`,
      });
    } else {
      ctx.seen.cvUrls.set(cvUrl, ctx.rowNumber);
    }
  }

  // Duplicates against the existing database (read-only).
  issues.push(
    ...(await findDbDuplicates(ctx.db, { candidateId, phone, email, fullName, positionId })),
  );

  return { ...finish(issues), safeRef: candidateId };
}

// Shared by the tabs that hang off an existing candidate: resolve the row to
// one candidate by ID → phone → email → (documented) name+position.
async function resolveCandidateRef(values, ctx, issues, unmatchedCode) {
  const candidateId = isBlank(values.candidateId) ? null : String(values.candidateId).trim();
  const phone = take(issues, normalizePhone(values.phone));
  const email = take(issues, normalizeEmail(values.email));
  const fullName = take(issues, normalizeText(values.fullName, { singleLine: true }));

  const match = await matchCandidate(ctx.db, { candidateId, phone, email, fullName });
  if (match.ambiguous) {
    issues.push({
      code: 'ambiguous_candidate_match',
      detail: `${match.count} existing candidates match by ${match.by}; not attached`,
    });
    return { candidateId, matched: null };
  }
  if (!match.matched) {
    issues.push({ code: unmatchedCode, detail: 'no existing candidate matches this row' });
    return { candidateId, matched: null };
  }
  return { candidateId, matched: match.matched, by: match.by };
}

export async function validatePhoneScreenRow(values, ctx) {
  const issues = [];
  const ref = await resolveCandidateRef(values, ctx, issues, 'unmatched_phone_interview');

  take(issues, normalizeBoolean(values.called));
  const response = take(issues, normalizeText(values.response, { singleLine: true }));
  if (response)
    take(issues, resolveLookup(response, ctx.statusMaps.phoneResponse, 'unknown_status'));
  const result = take(issues, normalizeText(values.result, { singleLine: true }));
  if (result) take(issues, resolveLookup(result, ctx.statusMaps.phoneResult, 'unknown_status'));
  take(issues, normalizeText(values.review));
  take(issues, normalizeDateTime(values.interviewDatetime));

  return { ...finish(issues), safeRef: ref.matched?.code ?? ref.candidateId };
}

export async function validateInterviewRow(values, ctx) {
  const issues = [];
  const ref = await resolveCandidateRef(values, ctx, issues, 'unmatched_direct_interview');

  const scheduledAt = take(issues, normalizeDateTime(values.scheduledAt));
  if (!scheduledAt) {
    issues.push({ code: 'missing_required_field', detail: 'interview date/time is required' });
  }
  const attendance = take(issues, normalizeText(values.attendance, { singleLine: true }));
  if (attendance)
    take(issues, resolveLookup(attendance, ctx.statusMaps.attendance, 'unknown_status'));
  take(issues, normalizeText(values.interviewer, { singleLine: true, maxLength: 150 }));

  const scores = [
    'scoreTechnical',
    'scoreAi',
    'scoreCommunication',
    'scoreConfidence',
    'scoreCultureFit',
  ];
  const given = [];
  for (const name of scores) {
    const value = take(issues, normalizeScore(values[name]));
    if (value !== null) given.push(value);
    if (!isBlank(values[name]) && value === null) given.push(null);
  }
  if (given.length !== 0 && given.length !== scores.length) {
    issues.push({
      code: 'invalid_score',
      detail: 'the five scores must all be present together or all be empty',
    });
  }

  // The source total is never imported; it only cross-checks the five scores.
  if (!isBlank(values.totalSource) && given.length === scores.length && !given.includes(null)) {
    const sum = given.reduce((a, b) => a + b, 0);
    const sourceTotal = Number(String(values.totalSource).trim());
    if (sourceTotal !== sum) {
      issues.push({
        code: 'invalid_score',
        detail: `workbook total (${sourceTotal}) does not equal the sum of the five scores (${sum}); the database-calculated total is authoritative`,
      });
    }
  }

  const decision = take(issues, normalizeText(values.decision, { singleLine: true }));
  if (decision)
    take(issues, resolveLookup(decision, ctx.statusMaps.interviewDecision, 'unknown_status'));
  take(issues, normalizeText(values.recommendation, { singleLine: true }));
  take(issues, normalizeText(values.remarks, { maxLength: 2000 }));

  return { ...finish(issues), safeRef: ref.matched?.code ?? ref.candidateId };
}

export async function validateOfferRow(values, ctx) {
  const issues = [];
  const ref = await resolveCandidateRef(values, ctx, issues, 'unmatched_candidate');

  const positionWord = take(issues, normalizeText(values.position, { singleLine: true }));
  if (positionWord) take(issues, resolveLookup(positionWord, ctx.positionMap, 'unknown_position'));

  const offerDate = take(issues, normalizeDate(values.offerDate));
  if (!offerDate) issues.push({ code: 'missing_required_field', detail: 'offer date is required' });

  const workMode = take(issues, normalizeText(values.workMode, { singleLine: true }));
  if (workMode) take(issues, resolveLookup(workMode, ctx.statusMaps.workMode, 'unknown_status'));
  const offerStatus = take(issues, normalizeText(values.offerStatus, { singleLine: true }));
  if (offerStatus)
    take(issues, resolveLookup(offerStatus, ctx.statusMaps.offerStatus, 'unknown_status'));
  take(issues, normalizeText(values.location, { singleLine: true }));
  take(issues, normalizeDate(values.onboardingDate));
  take(issues, normalizeBoolean(values.attended));

  return { ...finish(issues), safeRef: ref.matched?.code ?? ref.candidateId };
}

export async function validateEmployeeRow(values, ctx) {
  const issues = [];
  const ref = await resolveCandidateRef(values, ctx, issues, 'unmatched_candidate');

  const joinDate = take(issues, normalizeDate(values.joinDate));
  if (!joinDate) issues.push({ code: 'missing_required_field', detail: 'join date is required' });

  const track = take(issues, normalizeText(values.track, { singleLine: true }));
  if (track) take(issues, resolveLookup(track, ctx.statusMaps.track, 'unknown_status'));
  const phase = take(issues, normalizeText(values.currentPhase, { singleLine: true }));
  if (phase) take(issues, resolveLookup(phase, ctx.statusMaps.phase, 'unknown_status'));
  const status = take(issues, normalizeText(values.status, { singleLine: true }));
  if (status) take(issues, resolveLookup(status, ctx.statusMaps.employeeStatus, 'unknown_status'));
  take(issues, normalizeDate(values.phaseStart));
  // Phase end is normalized but never derived: the junior 9-month rule is
  // unresolved, so only a date the workbook itself holds is accepted.
  take(issues, normalizeDate(values.phaseEnd));

  return { ...finish(issues), safeRef: ref.matched?.code ?? ref.candidateId };
}

// Interview schedules (Tab 7): no Candidate ID, so a row is matched to the
// master by phone and then by name. Nothing is converted that the guide
// leaves for HR to confirm: day-first text dates, the lost leading zero of a
// phone and every status, source and position word stay in review until an
// approved mapping exists.
export async function validateInterviewScheduleRow(values, ctx) {
  const issues = [];

  const fullName = take(
    issues,
    normalizeText(values.fullName, { singleLine: true, maxLength: 150 }),
  );
  if (!fullName) issues.push({ code: 'missing_required_field', detail: 'Name is empty' });

  const phone = take(issues, normalizePhone(values.phone));
  if (phone && /^[1-9][0-9]{8}$/.test(phone)) {
    issues.push({
      code: 'invalid_phone',
      detail:
        '9 digits with no leading 0: the zero was probably lost; the restore rule is unconfirmed, so it is not repaired',
    });
  }
  if (!isBlank(values.phone) && !phone && !issues.some((i) => i.code === 'invalid_phone')) {
    issues.push({ code: 'invalid_phone', detail: 'phone could not be read' });
  }
  if (isBlank(values.phone)) {
    issues.push({ code: 'missing_required_field', detail: 'Contact # is empty' });
  }

  // The date column mixes date and time as text, day first. The guide asks
  // HR to confirm mixed formats, so nothing is converted here.
  const dateText = isBlank(values.scheduledText) ? null : String(values.scheduledText).trim();
  if (!dateText) {
    issues.push({ code: 'missing_required_field', detail: 'Date is empty' });
  } else if (/^d{1,2}[/.-]d{1,2}[/.-]d{2,4}/.test(dateText)) {
    issues.push({
      code: 'invalid_date',
      detail: 'day-first text date; conversion is not approved yet and the value is not converted',
    });
  } else {
    take(issues, normalizeDateTime(values.scheduledText));
  }

  const positionWord = take(issues, normalizeText(values.position, { singleLine: true }));
  let positionId = null;
  if (positionWord) {
    positionId = take(issues, resolveLookup(positionWord, ctx.positionMap, 'unknown_position'));
  } else {
    issues.push({ code: 'missing_required_field', detail: 'Position is empty' });
  }
  const sourceWord = take(issues, normalizeText(values.source, { singleLine: true }));
  if (sourceWord) take(issues, resolveLookup(sourceWord, ctx.sourceMap, 'unknown_source'));

  take(issues, normalizeText(values.mode, { singleLine: true, maxLength: 50 }));
  const statusWord = take(issues, normalizeText(values.status, { singleLine: true }));
  if (statusWord) {
    take(issues, resolveLookup(statusWord, ctx.statusMaps.scheduleStatus, 'unknown_status'));
  }
  take(issues, normalizeText(values.remarks, { maxLength: 2000 }));

  // The same person at the same time twice in this file.
  const key = phoneMatchKey(phone);
  if (key && dateText) {
    const pair = `${key}|${dateText}`;
    const firstRow = ctx.seen.schedulePairs?.get(pair);
    if (firstRow) {
      issues.push({
        code: 'duplicate_schedule_row',
        detail: `the same phone and date also appear at row ${firstRow}`,
      });
    } else {
      ctx.seen.schedulePairs ??= new Map();
      ctx.seen.schedulePairs.set(pair, ctx.rowNumber);
    }
  }

  // Match to the master: phone, then name (+ position when it resolved).
  const match = await matchCandidate(ctx.db, { phone, fullName, positionId });
  if (match.ambiguous) {
    issues.push({
      code: 'ambiguous_candidate_match',
      detail: `${match.count} existing candidates match by ${match.by}; not attached`,
    });
  } else if (!match.matched) {
    issues.push({
      code: 'unmatched_schedule_row',
      detail: 'no existing candidate matches; the guide sends such rows to a review list',
    });
  }

  return { ...finish(issues), safeRef: match.matched?.code ?? null };
}

export const VALIDATORS = {
  interview_schedules: validateInterviewScheduleRow,
  candidates: validateCandidateRow,
  phone_screens: validatePhoneScreenRow,
  interviews: validateInterviewRow,
  offers: validateOfferRow,
  employees: validateEmployeeRow,
};
