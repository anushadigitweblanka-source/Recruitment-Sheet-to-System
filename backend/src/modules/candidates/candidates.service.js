import { inTransaction } from '../../db/transaction.js';
import { recordAudit } from '../audit/audit.js';
import { allocateCandidateId } from './candidateId.js';
import {
  EDITABLE_COLUMNS,
  findCandidate,
  findLikelyDuplicates,
  findLookup,
  insertCandidate,
  updateCandidate,
} from './candidates.repository.js';
import { normalizeName, phoneMatchKey, validateCandidate } from './candidates.validation.js';

// Every function here returns one of:
//   { ok: true, candidate }
//   { ok: false, reason: 'validation', fields }      a field is wrong
//   { ok: false, reason: 'duplicate', duplicates }   looks like an existing candidate
//   { ok: false, reason: 'not_found' }

const UNIQUE_VIOLATION = '23505';

// The fields that findLikelyDuplicates compares.
const MATCHING_FIELDS = ['phone', 'email', 'fullName', 'positionId'];

// Checks that cannot be done from the text alone: do the chosen position and
// source exist? (The Candidate ID is generated, so it is never checked here.)
async function checkAgainstDatabase(db, values, { existing = null } = {}) {
  const fields = {};

  for (const [name, table, label] of [
    ['positionId', 'positions', 'Applied Position'],
    ['sourceId', 'sources', 'Source'],
  ]) {
    if (values[name] === null) continue;
    const lookup = await findLookup(db, table, values[name]);
    // A value that has since been switched off may stay on a candidate who
    // already has it, but cannot be newly chosen.
    const keepingCurrent = existing && existing[name] === values[name];
    if (!lookup) {
      fields[name] = `${label} is not a valid choice.`;
    } else if (!lookup.isActive && !keepingCurrent) {
      fields[name] = `${label} is no longer in use. Choose another.`;
    }
  }
  return fields;
}

function findDuplicates(db, values, excludeId = null) {
  return findLikelyDuplicates(db, {
    phoneKey: phoneMatchKey(values.phone),
    email: values.email,
    nameKey: normalizeName(values.fullName),
    positionId: values.positionId,
    excludeId,
  });
}

// Two registrations of the SAME person at the same moment take turns: each
// takes a lock named after the person's phone, email and name+position for the
// rest of its transaction, and checks for duplicates only after getting it. So
// the second one sees the first one's committed record and gets the usual
// duplicate warning instead of saving a second copy. Locks are always taken in
// the same sorted order, so two registrations can never wait on each other.
async function lockSamePerson(db, values) {
  const keys = [
    values.phone && phoneMatchKey(values.phone) && `phone:${phoneMatchKey(values.phone)}`,
    values.email && `email:${values.email}`,
    values.positionId && `name:${normalizeName(values.fullName)}|${values.positionId}`,
  ]
    .filter(Boolean)
    .sort();
  for (const key of keys)
    await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [key]);
}

const MAX_ID_ATTEMPTS = 3;

// Registers a candidate. The Candidate ID is generated here, in the same
// transaction that saves the candidate, so it is never chosen by the browser
// and a failed save uses no number. `now` and `via` are optional: the moment
// that decides the ID's date (tests), and where the data came from (audit).
export async function createCandidate(
  pool,
  user,
  input,
  { confirmDuplicate = false, now = new Date(), via = null } = {},
) {
  const { values, errors } = validateCandidate(input);
  if (Object.keys(errors).length > 0) return { ok: false, reason: 'validation', fields: errors };

  const fields = await checkAgainstDatabase(pool, values);
  if (Object.keys(fields).length > 0) return { ok: false, reason: 'validation', fields };

  for (let attempt = 1; ; attempt += 1) {
    try {
      const outcome = await inTransaction(pool, async (db) => {
        await lockSamePerson(db, values);

        // A likely duplicate is a warning, not a refusal: nothing is saved
        // until the user has seen the matches and chosen to continue. Nothing
        // is ever merged.
        const duplicates = await findDuplicates(db, values);
        if (duplicates.length > 0 && !confirmDuplicate) return { duplicates, id: null };

        const candidateCode = await allocateCandidateId(db, now);
        const saved = { ...values, candidateCode };
        const newId = await insertCandidate(db, saved, user.id);
        const details = {
          ...(duplicates.length > 0
            ? { savedDespiteLikelyDuplicates: duplicates.map((d) => d.id) }
            : {}),
          ...(via ? { via } : {}),
        };
        await recordAudit(db, {
          actorUserId: user.id,
          action: 'CANDIDATE_CREATE',
          entityType: 'candidates',
          entityId: newId,
          newValues: saved,
          details: Object.keys(details).length > 0 ? details : null,
        });
        return { duplicates, id: newId };
      });

      if (outcome.id === null)
        return { ok: false, reason: 'duplicate', duplicates: outcome.duplicates };
      return { ok: true, candidate: await findCandidate(pool, outcome.id) };
    } catch (err) {
      // The unique index caught an ID clash the lock did not prevent (for
      // example a record added by another tool). The whole save was rolled
      // back, so trying again simply allocates the next free number.
      const clash =
        err.code === UNIQUE_VIOLATION && err.constraint === 'candidates_candidate_code_key';
      if (!clash || attempt >= MAX_ID_ATTEMPTS) throw err;
    }
  }
}

export async function editCandidate(pool, user, id, input, { confirmDuplicate = false } = {}) {
  const existing = await findCandidate(pool, id);
  if (!existing) return { ok: false, reason: 'not_found' };

  const { values, errors } = validateCandidate(input);
  if (Object.keys(errors).length > 0) return { ok: false, reason: 'validation', fields: errors };
  // A Candidate ID is permanent: whatever the request holds, it is kept as it is.
  values.candidateCode = existing.candidateCode;

  const fields = await checkAgainstDatabase(pool, values, { existing });
  if (Object.keys(fields).length > 0) return { ok: false, reason: 'validation', fields };

  // Only what actually changed is saved and audited.
  const changes = {};
  const before = {};
  for (const name of Object.keys(EDITABLE_COLUMNS)) {
    if (values[name] !== existing[name]) {
      changes[name] = values[name];
      before[name] = existing[name];
    }
  }
  if (Object.keys(changes).length === 0) return { ok: true, candidate: existing, unchanged: true };

  // The duplicate check runs again only when a field used for matching was
  // changed. Otherwise two records already confirmed as separate people would
  // raise the same warning every time either one's comment was edited.
  const matchingFieldChanged = MATCHING_FIELDS.some((name) => name in changes);
  const duplicates = matchingFieldChanged ? await findDuplicates(pool, values, id) : [];
  if (duplicates.length > 0 && !confirmDuplicate) {
    return { ok: false, reason: 'duplicate', duplicates };
  }

  await inTransaction(pool, async (db) => {
    await updateCandidate(db, id, changes, user.id);
    await recordAudit(db, {
      actorUserId: user.id,
      action: 'CANDIDATE_UPDATE',
      entityType: 'candidates',
      entityId: id,
      oldValues: before,
      newValues: changes,
      details:
        duplicates.length > 0
          ? { savedDespiteLikelyDuplicates: duplicates.map((d) => d.id) }
          : null,
    });
  });
  return { ok: true, candidate: await findCandidate(pool, id) };
}
