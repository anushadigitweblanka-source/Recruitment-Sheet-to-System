import { recordAudit } from '../audit/audit.js';
import {
  EDITABLE_COLUMNS,
  candidateCodeInUse,
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

// Checks that cannot be done from the text alone: is the Candidate ID free,
// and do the chosen position and source exist?
async function checkAgainstDatabase(db, values, { existing = null } = {}) {
  const fields = {};

  if (await candidateCodeInUse(db, values.candidateCode, existing?.id ?? null)) {
    fields.candidateCode = 'This Candidate ID is already used by another candidate.';
  }

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

async function inTransaction(pool, work) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Two people saving the same Candidate ID at the same moment: the database's
// unique rule catches the second one, and it is reported like any other clash.
function asValidationIfCodeClash(err) {
  if (err.code === UNIQUE_VIOLATION && err.constraint === 'candidates_candidate_code_key') {
    return {
      ok: false,
      reason: 'validation',
      fields: { candidateCode: 'This Candidate ID is already used by another candidate.' },
    };
  }
  throw err;
}

export async function createCandidate(pool, user, input, { confirmDuplicate = false } = {}) {
  const { values, errors } = validateCandidate(input);
  if (Object.keys(errors).length > 0) return { ok: false, reason: 'validation', fields: errors };

  const fields = await checkAgainstDatabase(pool, values);
  if (Object.keys(fields).length > 0) return { ok: false, reason: 'validation', fields };

  // A likely duplicate is a warning, not a refusal: nothing is saved until the
  // user has seen the matches and chosen to continue. Nothing is ever merged.
  const duplicates = await findDuplicates(pool, values);
  if (duplicates.length > 0 && !confirmDuplicate) {
    return { ok: false, reason: 'duplicate', duplicates };
  }

  try {
    const id = await inTransaction(pool, async (db) => {
      const newId = await insertCandidate(db, values, user.id);
      await recordAudit(db, {
        actorUserId: user.id,
        action: 'CANDIDATE_CREATE',
        entityType: 'candidates',
        entityId: newId,
        newValues: values,
        details:
          duplicates.length > 0
            ? { savedDespiteLikelyDuplicates: duplicates.map((d) => d.id) }
            : null,
      });
      return newId;
    });
    return { ok: true, candidate: await findCandidate(pool, id) };
  } catch (err) {
    return asValidationIfCodeClash(err);
  }
}

export async function editCandidate(pool, user, id, input, { confirmDuplicate = false } = {}) {
  const existing = await findCandidate(pool, id);
  if (!existing) return { ok: false, reason: 'not_found' };

  const { values, errors } = validateCandidate(input);
  if (Object.keys(errors).length > 0) return { ok: false, reason: 'validation', fields: errors };

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

  try {
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
  } catch (err) {
    return asValidationIfCodeClash(err);
  }
}
