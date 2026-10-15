// All SQL for employees and their phases. `db` is the pool, or a client inside
// a transaction. Dates are read as "YYYY-MM-DD" text, so a calendar date never
// shifts with the time zone of the server.

const escapeLike = (text) => text.replace(/[\\%_]/g, '\\$&');
const day = (column, as = column.split('.').pop()) => `to_char(${column}, 'YYYY-MM-DD') AS ${as}`;

// The lifecycle durations, from the settings table.
export async function readLifecycleSettings(db) {
  const { rows } = await db.query(
    `SELECT key, value FROM settings
      WHERE key IN ('evaluation_days', 'probation_months', 'probation_max_extension_months',
                    'junior_months')`,
  );
  const value = (key) => {
    const found = rows.find((row) => row.key === key);
    const n = Number(found?.value);
    if (!Number.isInteger(n) || n < 1) throw new Error(`Setting ${key} is missing or invalid`);
    return n;
  };
  return {
    evaluationDays: value('evaluation_days'),
    probationMonths: value('probation_months'),
    juniorMonths: value('junior_months'),
    probationMaxExtensionMonths: value('probation_max_extension_months'),
  };
}

export async function employeeIdForCandidate(db, candidateId) {
  const { rows } = await db.query('SELECT id FROM employees WHERE candidate_id = $1', [
    candidateId,
  ]);
  return rows[0] ? Number(rows[0].id) : null;
}

// Reads the employee and holds the row until the transaction ends, so two
// decisions saved at the same moment are handled one after the other.
export async function lockEmployee(db, id) {
  const { rows } = await db.query(
    `SELECT id, candidate_id, ${day('join_date')}, track, current_phase, status
       FROM employees WHERE id = $1 FOR UPDATE`,
    [id],
  );
  if (rows.length === 0) return null;
  const row = rows[0];
  return {
    id: Number(row.id),
    candidateId: Number(row.candidate_id),
    joinDate: row.join_date,
    track: row.track,
    currentPhase: row.current_phase,
    status: row.status,
  };
}

const toPhase = (row) => ({
  id: Number(row.id),
  phase: row.phase,
  startDate: row.start_date,
  endDate: row.end_date,
  isExtension: row.is_extension,
  result: row.result,
  resultReason: row.result_reason,
  reviewDocUrl: row.review_doc_url,
  reviewedBy: row.reviewed_by_name ?? null,
  decidedAt: row.decided_at,
});

const PHASE_COLUMNS = `ph.id, ph.phase, ${day('ph.start_date')}, ${day('ph.end_date')}, ph.is_extension,
  ph.result, ph.result_reason, ph.review_doc_url, ph.decided_at`;

// The open phase (no decision yet), held until the transaction ends.
export async function lockOpenPhase(db, employeeId) {
  const { rows } = await db.query(
    `SELECT ${PHASE_COLUMNS} FROM phase_history ph
      WHERE ph.employee_id = $1 AND ph.result IS NULL FOR UPDATE`,
    [employeeId],
  );
  return rows[0] ? toPhase(rows[0]) : null;
}

// The end date of the original probation period, before any extension.
export async function originalProbationEnd(db, employeeId) {
  const { rows } = await db.query(
    `SELECT ${day('end_date')} FROM phase_history
      WHERE employee_id = $1 AND phase = 'probation' AND NOT is_extension
      ORDER BY id LIMIT 1`,
    [employeeId],
  );
  return rows[0]?.end_date ?? null;
}

export async function insertEmployee(db, { candidateId, joinDate, phaseEnd }, userId) {
  const { rows } = await db.query(
    `INSERT INTO employees (candidate_id, join_date, current_phase, phase_start, phase_end, created_by, updated_by)
     VALUES ($1, $2, 'evaluation', $2, $3, $4, $4)
     RETURNING id`,
    [candidateId, joinDate, phaseEnd, userId],
  );
  return Number(rows[0].id);
}

export async function insertPhase(
  db,
  { employeeId, phase, startDate, endDate, isExtension = false },
  userId,
) {
  const { rows } = await db.query(
    `INSERT INTO phase_history (employee_id, phase, start_date, end_date, is_extension, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $6)
     RETURNING id`,
    [employeeId, phase, startDate, endDate, isExtension, userId],
  );
  return Number(rows[0].id);
}

// Records the gate decision on the open phase. `endDate` is only given when
// the decision itself supplies it (the junior end date).
export async function closePhase(db, id, { result, reason, reviewDocUrl, endDate }, userId) {
  await db.query(
    `UPDATE phase_history
        SET result = $2, result_reason = $3, review_doc_url = $4,
            end_date = COALESCE($5::date, end_date),
            reviewed_by = $6, decided_at = now(), updated_at = now(), updated_by = $6
      WHERE id = $1`,
    [id, result, reason, reviewDocUrl, endDate, userId],
  );
}

export async function setCurrentPhase(db, id, { phase, startDate, endDate }, userId) {
  await db.query(
    `UPDATE employees
        SET current_phase = $2, phase_start = $3, phase_end = $4, updated_at = now(), updated_by = $5
      WHERE id = $1`,
    [id, phase, startDate, endDate, userId],
  );
}

// The current phase's end date, when the gate decision supplies it.
export async function setPhaseEnd(db, id, endDate, userId) {
  await db.query(
    'UPDATE employees SET phase_end = $2, updated_at = now(), updated_by = $3 WHERE id = $1',
    [id, endDate, userId],
  );
}

export async function setExit(db, id, { status, exitDate, exitReason, approvedBy }, userId) {
  await db.query(
    `UPDATE employees
        SET status = $2, exit_date = $3, exit_reason = $4, exit_approved_by = $5,
            updated_at = now(), updated_by = $6
      WHERE id = $1`,
    [id, status, exitDate, exitReason, approvedBy, userId],
  );
}

export async function setTrack(db, id, track, userId) {
  await db.query(
    'UPDATE employees SET track = $2, updated_at = now(), updated_by = $3 WHERE id = $1',
    [id, track, userId],
  );
}

// The position the candidate was offered, from their latest offer.
const FROM_EMPLOYEES = `
  FROM employees e
  JOIN candidates c ON c.id = e.candidate_id
  LEFT JOIN LATERAL (
    SELECT p.name FROM offers o JOIN positions p ON p.id = o.position_id
     WHERE o.candidate_id = c.id ORDER BY o.id DESC LIMIT 1
  ) op ON true`;

// The next decision is due at the end of the current phase, while the
// employee is active. Senior has none; a junior phase with no end date
// entered has none yet.
const NEXT_REVIEW = `CASE WHEN e.status = 'active' AND e.current_phase <> 'senior' THEN e.phase_end END`;

const EMPLOYEE_COLUMNS = `
  e.id, c.id AS candidate_id, c.candidate_code, c.full_name, op.name AS position_name,
  ${day('e.join_date')}, e.track, e.current_phase, ${day('e.phase_start')}, ${day('e.phase_end')},
  e.status, to_char(${NEXT_REVIEW}, 'YYYY-MM-DD') AS next_review`;

const toListItem = (row) => ({
  id: Number(row.id),
  candidate: {
    id: Number(row.candidate_id),
    candidateCode: row.candidate_code,
    fullName: row.full_name,
  },
  position: row.position_name ?? null,
  joinDate: row.join_date,
  track: row.track,
  currentPhase: row.current_phase,
  phaseStart: row.phase_start,
  phaseEnd: row.phase_end,
  status: row.status,
  nextReview: row.next_review,
});

export async function listEmployees(db, filters) {
  const where = [];
  const params = [];
  const add = (value) => {
    params.push(value);
    return `$${params.length}`;
  };

  if (filters.search) {
    const pattern = add(`%${escapeLike(filters.search)}%`);
    where.push(`(c.full_name ILIKE ${pattern} OR c.candidate_code ILIKE ${pattern})`);
  }
  if (filters.phase) where.push(`e.current_phase = ${add(filters.phase)}`);
  if (filters.track === 'none') where.push('e.track IS NULL');
  else if (filters.track) where.push(`e.track = ${add(filters.track)}`);
  if (filters.status === 'exited') where.push(`e.status <> 'active'`);
  else if (filters.status) where.push(`e.status = ${add(filters.status)}`);
  if (filters.reviewFrom) where.push(`(${NEXT_REVIEW}) >= ${add(filters.reviewFrom)}::date`);
  if (filters.reviewTo) where.push(`(${NEXT_REVIEW}) <= ${add(filters.reviewTo)}::date`);

  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const total = await db.query(
    `SELECT count(*)::int AS total ${FROM_EMPLOYEES} ${whereSql}`,
    params,
  );

  const limit = add(filters.pageSize);
  const offset = add((filters.page - 1) * filters.pageSize);
  const { rows } = await db.query(
    `SELECT ${EMPLOYEE_COLUMNS}
     ${FROM_EMPLOYEES}
     ${whereSql}
     ORDER BY e.join_date DESC, e.id DESC
     LIMIT ${limit} OFFSET ${offset}`,
    params,
  );
  return { items: rows.map(toListItem), total: total.rows[0].total };
}

// One employee with the candidate and every phase, oldest first.
export async function findEmployee(db, id) {
  const { rows } = await db.query(
    `SELECT ${EMPLOYEE_COLUMNS}, c.phone, ${day('e.exit_date')}, e.exit_reason,
            ua.full_name AS exit_approved_by_name, e.updated_at, uu.full_name AS updated_by_name
     ${FROM_EMPLOYEES}
     LEFT JOIN users ua ON ua.id = e.exit_approved_by
     LEFT JOIN users uu ON uu.id = e.updated_by
     WHERE e.id = $1`,
    [id],
  );
  if (rows.length === 0) return null;
  const row = rows[0];

  const phases = await db.query(
    `SELECT ${PHASE_COLUMNS}, u.full_name AS reviewed_by_name
       FROM phase_history ph
       LEFT JOIN users u ON u.id = ph.reviewed_by
      WHERE ph.employee_id = $1
      ORDER BY ph.start_date, ph.id`,
    [id],
  );

  const { candidate, ...employee } = toListItem(row);
  return {
    candidate: { ...candidate, phone: row.phone },
    employee: {
      ...employee,
      exitDate: row.exit_date,
      exitReason: row.exit_reason,
      exitApprovedBy: row.exit_approved_by_name,
      updatedAt: row.updated_at,
      updatedBy: row.updated_by_name,
    },
    phases: phases.rows.map(toPhase),
  };
}
