// Dry-run candidate matching against the existing database, read-only.
// Order (from duplicate-risk-reports/import-duplicate-rules.md and the
// implemented application rules):
//   1. Candidate ID exact match
//   2. normalized phone (last nine digits)
//   3. email (lowercased exact)
//   4. normalized name + position, only when the position resolved
// Several different candidates matching = ambiguous = review. Nothing is
// ever attached automatically on an ambiguous match.

import { normalizeName, phoneMatchKey } from '../modules/candidates/candidates.validation.js';

export async function matchCandidate(db, { candidateId, phone, email, fullName, positionId }) {
  if (candidateId) {
    const { rows } = await db.query(
      'SELECT id, candidate_code FROM candidates WHERE candidate_code = $1',
      [candidateId],
    );
    if (rows.length === 1) {
      return {
        matched: { id: Number(rows[0].id), code: rows[0].candidate_code },
        by: 'candidate_id',
      };
    }
  }

  const key = phoneMatchKey(phone);
  if (key) {
    const { rows } = await db.query(
      `SELECT id, candidate_code FROM candidates
        WHERE phone IS NOT NULL
          AND right(regexp_replace(phone, '\\D', '', 'g'), 9) = $1`,
      [key],
    );
    if (rows.length === 1) {
      return { matched: { id: Number(rows[0].id), code: rows[0].candidate_code }, by: 'phone' };
    }
    if (rows.length > 1) return { ambiguous: true, by: 'phone', count: rows.length };
  }

  if (email) {
    const { rows } = await db.query(
      'SELECT id, candidate_code FROM candidates WHERE lower(email) = $1',
      [email.toLowerCase()],
    );
    if (rows.length === 1) {
      return { matched: { id: Number(rows[0].id), code: rows[0].candidate_code }, by: 'email' };
    }
    if (rows.length > 1) return { ambiguous: true, by: 'email', count: rows.length };
  }

  if (fullName && positionId) {
    const { rows } = await db.query(
      `SELECT id, candidate_code FROM candidates
        WHERE position_id = $2
          AND lower(regexp_replace(full_name, '\\s+', ' ', 'g')) = $1`,
      [normalizeName(fullName), positionId],
    );
    if (rows.length === 1) {
      return {
        matched: { id: Number(rows[0].id), code: rows[0].candidate_code },
        by: 'name_position',
      };
    }
    if (rows.length > 1) return { ambiguous: true, by: 'name_position', count: rows.length };
  }

  return { matched: null };
}

// Likely duplicates of a would-be NEW candidate row, against the database
// (same checks the application makes on manual entry). Returns issue codes.
export async function findDbDuplicates(db, { candidateId, phone, email, fullName, positionId }) {
  const issues = [];

  if (candidateId) {
    const { rows } = await db.query('SELECT 1 FROM candidates WHERE candidate_code = $1', [
      candidateId,
    ]);
    if (rows.length > 0) {
      issues.push({
        code: 'duplicate_candidate_id',
        detail: 'this Candidate ID already exists in the system',
      });
    }
  }

  const key = phoneMatchKey(phone);
  if (key) {
    const { rows } = await db.query(
      `SELECT candidate_code FROM candidates
        WHERE phone IS NOT NULL
          AND right(regexp_replace(phone, '\\D', '', 'g'), 9) = $1`,
      [key],
    );
    if (rows.length > 0) {
      issues.push({
        code: 'duplicate_candidate',
        detail: `phone matches existing candidate(s): ${rows.map((r) => r.candidate_code).join(', ')}`,
      });
    }
  }

  if (email) {
    const { rows } = await db.query(
      'SELECT candidate_code FROM candidates WHERE lower(email) = $1',
      [email.toLowerCase()],
    );
    if (rows.length > 0) {
      issues.push({
        code: 'duplicate_candidate',
        detail: `email matches existing candidate(s): ${rows.map((r) => r.candidate_code).join(', ')}`,
      });
    }
  }

  if (fullName && positionId) {
    const { rows } = await db.query(
      `SELECT candidate_code FROM candidates
        WHERE position_id = $2
          AND lower(regexp_replace(full_name, '\\s+', ' ', 'g')) = $1`,
      [normalizeName(fullName), positionId],
    );
    if (rows.length > 0) {
      issues.push({
        code: 'duplicate_candidate',
        detail: `same name and position as existing candidate(s): ${rows.map((r) => r.candidate_code).join(', ')}`,
      });
    }
  }

  return issues;
}
