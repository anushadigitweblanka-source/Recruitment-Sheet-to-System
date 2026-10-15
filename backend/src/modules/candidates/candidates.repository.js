import { teamScopeClause } from '../team-leads/teamScope.js';

// All SQL for candidates. `db` is the pool, or a client inside a transaction.

// API field name -> column name, for the fields a user can edit.
export const EDITABLE_COLUMNS = {
  candidateCode: 'candidate_code',
  fullName: 'full_name',
  phone: 'phone',
  email: 'email',
  address: 'address',
  olMaths: 'ol_maths',
  alResult: 'al_result',
  alStream: 'al_stream',
  otherEducation: 'other_education',
  positionId: 'position_id',
  sourceId: 'source_id',
  cvUrl: 'cv_url',
  companyCvUrl: 'company_cv_url',
  hrComment: 'hr_comment',
};

const SORT_COLUMNS = {
  createdAt: 'c.created_at',
  name: 'lower(c.full_name)',
  candidateCode: 'lower(c.candidate_code)',
};

const idOrNull = (value) => (value === null || value === undefined ? null : Number(value));
const named = (id, name) => (id === null || id === undefined ? null : { id: Number(id), name });

function toListItem(row) {
  return {
    id: Number(row.id),
    candidateCode: row.candidate_code,
    fullName: row.full_name,
    phone: row.phone,
    email: row.email,
    position: named(row.position_id, row.position_name),
    source: named(row.source_id, row.source_name),
    stage: { code: row.current_stage, name: row.stage_name },
    createdAt: row.created_at,
  };
}

function toCandidate(row) {
  return {
    ...toListItem(row),
    address: row.address,
    olMaths: row.ol_maths,
    alResult: row.al_result,
    alStream: row.al_stream,
    otherEducation: row.other_education,
    positionId: idOrNull(row.position_id),
    sourceId: idOrNull(row.source_id),
    cvUrl: row.cv_url,
    companyCvUrl: row.company_cv_url,
    companyCvStatus: row.company_cv_status,
    // Requested but not received: shown to HR and the Team Lead.
    companyCvPending: ['sent', 'overdue'].includes(row.company_cv_status),
    hrComment: row.hr_comment,
    createdBy: row.created_by_name,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by_name,
  };
}

const FROM_CANDIDATES = `
  FROM candidates c
  JOIN pipeline_status ps ON ps.candidate_id = c.id
  JOIN pipeline_stages st ON st.code = ps.current_stage
  LEFT JOIN positions p ON p.id = c.position_id
  LEFT JOIN sources s ON s.id = c.source_id`;

// Makes text safe to use inside a LIKE pattern.
const escapeLike = (text) => text.replace(/[\\%_]/g, '\\$&');

export async function listCandidates(db, filters, scope = null) {
  const where = [];
  const params = [];
  const add = (value) => {
    params.push(value);
    return `$${params.length}`;
  };

  // A Team Lead sees only the candidates of their own team.
  if (scope) where.push(teamScopeClause(add(scope.userId)));

  if (filters.search) {
    const pattern = add(`%${escapeLike(filters.search)}%`);
    const conditions = [
      `c.full_name ILIKE ${pattern}`,
      `c.candidate_code ILIKE ${pattern}`,
      `c.email ILIKE ${pattern}`,
    ];
    // Phone is matched on digits only, so "077 123" finds "0771234567".
    const digits = filters.search.replace(/\D/g, '');
    if (digits.length >= 3) {
      conditions.push(`regexp_replace(c.phone, '\\D', '', 'g') LIKE ${add(`%${digits}%`)}`);
    }
    where.push(`(${conditions.join(' OR ')})`);
  }
  if (filters.positionId) where.push(`c.position_id = ${add(filters.positionId)}`);
  if (filters.sourceId) where.push(`c.source_id = ${add(filters.sourceId)}`);
  if (filters.stage) where.push(`ps.current_stage = ${add(filters.stage)}`);

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = await db.query(
    `SELECT count(*)::int AS total ${FROM_CANDIDATES} ${whereSql}`,
    params,
  );

  // Sort column and direction come from fixed lists, never from the request text.
  const direction = filters.order === 'asc' ? 'ASC' : 'DESC';
  const limit = add(filters.pageSize);
  const offset = add((filters.page - 1) * filters.pageSize);
  const { rows } = await db.query(
    `SELECT c.id, c.candidate_code, c.full_name, c.phone, c.email, c.created_at,
            c.position_id, p.name AS position_name, c.source_id, s.name AS source_name,
            ps.current_stage, st.name AS stage_name
     ${FROM_CANDIDATES}
     ${whereSql}
     ORDER BY ${SORT_COLUMNS[filters.sort]} ${direction}, c.id ${direction}
     LIMIT ${limit} OFFSET ${offset}`,
    params,
  );

  return { items: rows.map(toListItem), total: total.rows[0].total };
}

export async function findCandidate(db, id, scope = null) {
  const { rows } = await db.query(
    `SELECT c.*, p.name AS position_name, s.name AS source_name,
            ps.current_stage, st.name AS stage_name,
            cu.full_name AS created_by_name, uu.full_name AS updated_by_name
     ${FROM_CANDIDATES}
     LEFT JOIN users cu ON cu.id = c.created_by
     LEFT JOIN users uu ON uu.id = c.updated_by
     WHERE c.id = $1${scope ? ` AND ${teamScopeClause('$2')}` : ''}`,
    scope ? [id, scope.userId] : [id],
  );
  return rows[0] ? toCandidate(rows[0]) : null;
}

export async function candidateCodeInUse(db, candidateCode, excludeId = null) {
  const { rows } = await db.query(
    `SELECT 1 FROM candidates
      WHERE lower(candidate_code) = lower($1) AND ($2::bigint IS NULL OR id <> $2)`,
    [candidateCode, excludeId],
  );
  return rows.length > 0;
}

// Which of the given lookup ids exist, and whether each is active.
export async function findLookup(db, table, id) {
  const { rows } = await db.query(`SELECT id, is_active FROM ${table} WHERE id = $1`, [id]);
  return rows[0] ? { id: Number(rows[0].id), isActive: rows[0].is_active } : null;
}

// Existing candidates that look like the same person: same phone (compared on
// the last nine digits), same email, or same name applying for the same position.
export async function findLikelyDuplicates(
  db,
  { phoneKey, email, nameKey, positionId, excludeId },
) {
  const { rows } = await db.query(
    `SELECT * FROM (
       SELECT c.id, c.candidate_code, c.full_name, c.phone, c.email, p.name AS position_name,
              ($1::text IS NOT NULL AND c.phone IS NOT NULL
                 AND right(regexp_replace(c.phone, '\\D', '', 'g'), 9) = $1) AS phone_match,
              ($2::text IS NOT NULL AND c.email = $2) AS email_match,
              ($4::bigint IS NOT NULL AND c.position_id = $4
                 AND lower(regexp_replace(c.full_name, '\\s+', ' ', 'g')) = $3) AS name_match
         FROM candidates c
         LEFT JOIN positions p ON p.id = c.position_id
        WHERE $5::bigint IS NULL OR c.id <> $5
     ) matches
     WHERE phone_match OR email_match OR name_match
     ORDER BY id
     LIMIT 10`,
    [phoneKey, email, nameKey, positionId, excludeId],
  );

  return rows.map((row) => ({
    id: Number(row.id),
    candidateCode: row.candidate_code,
    fullName: row.full_name,
    phone: row.phone,
    email: row.email,
    position: row.position_name,
    matchedOn: [
      row.phone_match && 'phone',
      row.email_match && 'email',
      row.name_match && 'name and position',
    ].filter(Boolean),
  }));
}

// Adds the candidate, its starting pipeline row and the first history row.
// Call inside a transaction.
export async function insertCandidate(db, values, userId) {
  const names = Object.keys(EDITABLE_COLUMNS);
  const columns = names.map((name) => EDITABLE_COLUMNS[name]);
  const placeholders = names.map((_, index) => `$${index + 1}`);

  const { rows } = await db.query(
    `INSERT INTO candidates (${columns.join(', ')}, created_by, updated_by)
     VALUES (${placeholders.join(', ')}, $${names.length + 1}, $${names.length + 1})
     RETURNING id`,
    [...names.map((name) => values[name]), userId],
  );
  const id = Number(rows[0].id);

  // Every candidate starts at "Applied".
  await db.query(
    `INSERT INTO pipeline_status (candidate_id, current_stage, updated_by) VALUES ($1, 'applied', $2)`,
    [id, userId],
  );
  await db.query(
    `INSERT INTO stage_history (candidate_id, from_stage, to_stage, changed_by) VALUES ($1, NULL, 'applied', $2)`,
    [id, userId],
  );
  return id;
}

export async function updateCandidate(db, id, changes, userId) {
  const names = Object.keys(changes);
  const assignments = names.map((name, index) => `${EDITABLE_COLUMNS[name]} = $${index + 1}`);

  await db.query(
    `UPDATE candidates
        SET ${assignments.join(', ')}, updated_at = now(), updated_by = $${names.length + 1}
      WHERE id = $${names.length + 2}`,
    [...names.map((name) => changes[name]), userId, id],
  );
}
