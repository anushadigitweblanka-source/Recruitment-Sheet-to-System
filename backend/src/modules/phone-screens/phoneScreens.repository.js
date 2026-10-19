import { latestMailStatusSql } from '../notifications/notifications.repository.js';

// All SQL for phone interviews. `db` is the pool, or a client inside a transaction.

// API field name -> column name, for the fields a user can set.
export const EDITABLE_COLUMNS = {
  called: 'called',
  response: 'response',
  result: 'result',
  review: 'review',
  interviewAt: 'interview_datetime',
};

const SCREEN_COLUMNS = `
  s.id AS screen_id, s.called, s.response, s.result, s.review, s.interview_datetime,
  s.updated_at AS screen_updated_at`;

// Each candidate with their phone interview, if they have one. Written as
// "the latest one", so it keeps working if several attempts are allowed later.
const FROM_CANDIDATES = `
  FROM candidates c
  JOIN pipeline_status ps ON ps.candidate_id = c.id
  JOIN pipeline_stages st ON st.code = ps.current_stage
  LEFT JOIN LATERAL (
    SELECT * FROM phone_screens x WHERE x.candidate_id = c.id ORDER BY x.id DESC LIMIT 1
  ) s ON true`;

const escapeLike = (text) => text.replace(/[\\%_]/g, '\\$&');

function toScreen(row) {
  if (row.screen_id === null || row.screen_id === undefined) return null;
  return {
    id: Number(row.screen_id),
    called: row.called,
    response: row.response,
    result: row.result,
    review: row.review,
    interviewAt: row.interview_datetime ? row.interview_datetime.toISOString() : null,
    updatedAt: row.screen_updated_at,
    updatedBy: row.screen_updated_by_name ?? undefined,
  };
}

function toCandidateSummary(row) {
  return {
    id: Number(row.id),
    candidateCode: row.candidate_code,
    fullName: row.full_name,
    phone: row.phone,
    stage: { code: row.current_stage, name: row.stage_name },
    // From the email log: the interview invitation's latest status, or null.
    mailStatus: row.mail_status ?? null,
  };
}

export async function listPhoneScreens(db, filters) {
  const where = [];
  const params = [];
  const add = (value) => {
    params.push(value);
    return `$${params.length}`;
  };

  if (filters.search) {
    const pattern = add(`%${escapeLike(filters.search)}%`);
    const conditions = [`c.full_name ILIKE ${pattern}`, `c.candidate_code ILIKE ${pattern}`];
    const digits = filters.search.replace(/\D/g, '');
    if (digits.length >= 3) {
      conditions.push(`regexp_replace(c.phone, '\\D', '', 'g') LIKE ${add(`%${digits}%`)}`);
    }
    where.push(`(${conditions.join(' OR ')})`);
  }
  if (filters.result === 'pending') where.push('s.result IS NULL');
  else if (filters.result) where.push(`s.result = ${add(filters.result)}`);
  // A candidate with no phone interview yet has not been called.
  if (filters.called !== null) where.push(`COALESCE(s.called, false) = ${add(filters.called)}`);

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = await db.query(
    `SELECT count(*)::int AS total ${FROM_CANDIDATES} ${whereSql}`,
    params,
  );

  const limit = add(filters.pageSize);
  const offset = add((filters.page - 1) * filters.pageSize);
  const { rows } = await db.query(
    `SELECT c.id, c.candidate_code, c.full_name, c.phone, ps.current_stage, st.name AS stage_name,
            ${latestMailStatusSql('interview_invitation')} AS mail_status,
            ${SCREEN_COLUMNS}
     ${FROM_CANDIDATES}
     ${whereSql}
     ORDER BY c.created_at DESC, c.id DESC
     LIMIT ${limit} OFFSET ${offset}`,
    params,
  );

  return {
    items: rows.map((row) => ({ candidate: toCandidateSummary(row), phoneScreen: toScreen(row) })),
    total: total.rows[0].total,
  };
}

// One candidate with their phone interview. Null when the candidate does not exist.
export async function findForCandidate(db, candidateId) {
  const { rows } = await db.query(
    `SELECT c.id, c.candidate_code, c.full_name, c.phone, c.email, p.name AS position_name,
            ps.current_stage, st.name AS stage_name, ps.reject_reason,
            ${latestMailStatusSql('interview_invitation')} AS mail_status,
            ${SCREEN_COLUMNS}, uu.full_name AS screen_updated_by_name
     ${FROM_CANDIDATES}
     LEFT JOIN positions p ON p.id = c.position_id
     LEFT JOIN users uu ON uu.id = s.updated_by
     WHERE c.id = $1`,
    [candidateId],
  );
  if (rows.length === 0) return null;
  const row = rows[0];

  return {
    candidate: { ...toCandidateSummary(row), email: row.email, position: row.position_name },
    phoneScreen: toScreen(row),
    // Shown and edited on the form while the candidate is rejected.
    rejectReason: row.current_stage === 'rejected' ? row.reject_reason : null,
  };
}

export async function findScreenById(db, id) {
  const { rows } = await db.query(
    `SELECT id, candidate_id, called, response, result, review, interview_datetime
       FROM phone_screens WHERE id = $1`,
    [id],
  );
  if (rows.length === 0) return null;
  const row = rows[0];
  return {
    id: Number(row.id),
    candidateId: Number(row.candidate_id),
    called: row.called,
    response: row.response,
    result: row.result,
    review: row.review,
    interviewAt: row.interview_datetime ? row.interview_datetime.toISOString() : null,
  };
}

export async function screenIdForCandidate(db, candidateId) {
  const { rows } = await db.query(
    'SELECT id FROM phone_screens WHERE candidate_id = $1 ORDER BY id DESC LIMIT 1',
    [candidateId],
  );
  return rows[0] ? Number(rows[0].id) : null;
}

export async function insertScreen(db, candidateId, values, userId) {
  const names = Object.keys(EDITABLE_COLUMNS);
  const { rows } = await db.query(
    `INSERT INTO phone_screens (candidate_id, ${names.map((n) => EDITABLE_COLUMNS[n]).join(', ')}, created_by, updated_by)
     VALUES ($1, ${names.map((_, i) => `$${i + 2}`).join(', ')}, $${names.length + 2}, $${names.length + 2})
     RETURNING id`,
    [candidateId, ...names.map((n) => values[n]), userId],
  );
  return Number(rows[0].id);
}

export async function updateScreen(db, id, changes, userId) {
  const names = Object.keys(changes);
  await db.query(
    `UPDATE phone_screens
        SET ${names.map((n, i) => `${EDITABLE_COLUMNS[n]} = $${i + 1}`).join(', ')},
            updated_at = now(), updated_by = $${names.length + 1}
      WHERE id = $${names.length + 2}`,
    [...names.map((n) => changes[n]), userId, id],
  );
}
