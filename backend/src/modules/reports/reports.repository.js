// All SQL for the reports. Read-only: nothing here writes, and no query ever
// selects a credential column. Salary does not exist anywhere in the schema.
//
// Query basis per report:
//   Candidate status  candidates joined with pipeline_status (one row per
//                     candidate), filtered on current stage, position, source
//                     and the date the candidate was added.
//   Funnel            per pipeline stage: how many candidates are there NOW
//                     (pipeline_status) and how many ENTERED the stage in the
//                     chosen period (stage_history.to_stage).
//   Sources/Positions per lookup value: total candidates plus the outcome
//                     breakdown from current stages (hired = joined,
//                     rejected, on hold, everything else = in progress).
//   Weekly            the chosen Monday-to-Sunday week in Asia/Colombo:
//                     candidates added (created_at - the only date available
//                     until the proposed applied_on column is approved) and
//                     stage movements from stage_history.
//   Onboarding        employees by join date, with phase and status.
//   Exit              discontinued and terminated employees with exit date
//                     and reason, filtered on exit date.
//
// Dates compare as calendar days in the office zone:
// (timestamp AT TIME ZONE 'Asia/Colombo')::date.

const COLOMBO_DATE = (column) => `(${column} AT TIME ZONE 'Asia/Colombo')::date`;

export async function candidateStatusReport(db, filters) {
  const where = [];
  const params = [];
  const add = (value) => {
    params.push(value);
    return `$${params.length}`;
  };

  if (filters.stage) where.push(`ps.current_stage = ${add(filters.stage)}`);
  if (filters.positionId) where.push(`c.position_id = ${add(filters.positionId)}`);
  if (filters.sourceId) where.push(`c.source_id = ${add(filters.sourceId)}`);
  if (filters.from) where.push(`${COLOMBO_DATE('c.created_at')} >= ${add(filters.from)}::date`);
  if (filters.to) where.push(`${COLOMBO_DATE('c.created_at')} <= ${add(filters.to)}::date`);

  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const base = `FROM candidates c
      JOIN pipeline_status ps ON ps.candidate_id = c.id
      LEFT JOIN pipeline_stages s ON s.code = ps.current_stage
      LEFT JOIN positions p ON p.id = c.position_id
      LEFT JOIN sources src ON src.id = c.source_id
      ${whereSql}`;

  const total = await db.query(`SELECT count(*)::int AS total ${base}`, params);
  const limit = add(filters.pageSize);
  const offset = add((filters.page - 1) * filters.pageSize);
  const { rows } = await db.query(
    `SELECT c.id, c.candidate_code, c.full_name, p.name AS position, src.name AS source,
            ps.current_stage, s.name AS stage_name, ps.stage_changed_at, c.created_at
       ${base}
      ORDER BY c.created_at DESC, c.id DESC
      LIMIT ${limit} OFFSET ${offset}`,
    params,
  );

  return {
    total: total.rows[0].total,
    items: rows.map((row) => ({
      id: Number(row.id),
      candidateCode: row.candidate_code,
      fullName: row.full_name,
      position: row.position,
      source: row.source,
      stage: row.current_stage,
      stageName: row.stage_name,
      stageChangedAt: row.stage_changed_at,
      createdAt: row.created_at,
    })),
  };
}

export async function funnelReport(db, { from, to }) {
  const params = [];
  const movement = [];
  if (from) {
    params.push(from);
    movement.push(`${COLOMBO_DATE('h.changed_at')} >= $${params.length}::date`);
  }
  if (to) {
    params.push(to);
    movement.push(`${COLOMBO_DATE('h.changed_at')} <= $${params.length}::date`);
  }
  const movementSql = movement.length > 0 ? `AND ${movement.join(' AND ')}` : '';

  const { rows } = await db.query(
    `SELECT s.code, s.name, s.sort_order,
            (SELECT count(*)::int FROM pipeline_status ps WHERE ps.current_stage = s.code) AS current,
            (SELECT count(*)::int FROM stage_history h
              WHERE h.to_stage = s.code ${movementSql}) AS entered
       FROM pipeline_stages s
      ORDER BY s.sort_order`,
    params,
  );
  return rows.map((row) => ({
    stage: row.code,
    stageName: row.name,
    current: row.current,
    entered: row.entered,
  }));
}

// Shared by the source and position reports: the outcome buckets are derived
// from the candidate's CURRENT stage, so each candidate lands in one bucket.
const OUTCOMES = `
  count(*)::int AS total,
  count(*) FILTER (WHERE ps.current_stage = 'joined')::int AS hired,
  count(*) FILTER (WHERE ps.current_stage = 'rejected')::int AS rejected,
  count(*) FILTER (WHERE ps.current_stage = 'on_hold')::int AS on_hold,
  count(*) FILTER (WHERE ps.current_stage IN ('not_attended', 'no_response'))::int AS unresponsive,
  count(*) FILTER (WHERE ps.current_stage NOT IN
    ('joined', 'rejected', 'on_hold', 'not_attended', 'no_response'))::int AS in_progress`;

const toBreakdown = (row) => ({
  name: row.name ?? '(not recorded)',
  total: row.total,
  hired: row.hired,
  rejected: row.rejected,
  onHold: row.on_hold,
  unresponsive: row.unresponsive,
  inProgress: row.in_progress,
});

export async function sourceReport(db) {
  const { rows } = await db.query(
    `SELECT src.name, ${OUTCOMES}
       FROM candidates c
       JOIN pipeline_status ps ON ps.candidate_id = c.id
       LEFT JOIN sources src ON src.id = c.source_id
      GROUP BY src.name
      ORDER BY count(*) DESC, src.name`,
  );
  return rows.map(toBreakdown);
}

export async function positionReport(db) {
  const { rows } = await db.query(
    `SELECT p.name, ${OUTCOMES}
       FROM candidates c
       JOIN pipeline_status ps ON ps.candidate_id = c.id
       LEFT JOIN positions p ON p.id = c.position_id
      GROUP BY p.name
      ORDER BY count(*) DESC, p.name`,
  );
  return rows.map(toBreakdown);
}

export async function weeklyReport(db, { weekStart, weekEnd }) {
  const applications = await db.query(
    `SELECT count(*)::int AS total FROM candidates c
      WHERE ${COLOMBO_DATE('c.created_at')} BETWEEN $1::date AND $2::date`,
    [weekStart, weekEnd],
  );

  const movements = await db.query(
    `SELECT h.to_stage, s.name, count(*)::int AS total
       FROM stage_history h
       LEFT JOIN pipeline_stages s ON s.code = h.to_stage
      WHERE ${COLOMBO_DATE('h.changed_at')} BETWEEN $1::date AND $2::date
      GROUP BY h.to_stage, s.name, s.sort_order
      ORDER BY s.sort_order`,
    [weekStart, weekEnd],
  );

  const pick = (stage) => movements.rows.find((row) => row.to_stage === stage)?.total ?? 0;

  return {
    weekStart,
    weekEnd,
    applications: applications.rows[0].total,
    movements: movements.rows.map((row) => ({
      stage: row.to_stage,
      stageName: row.name,
      total: row.total,
    })),
    offersSent: pick('offer_sent'),
    offersAccepted: pick('offer_accepted'),
    joined: pick('joined'),
    rejected: pick('rejected'),
  };
}

export async function onboardingReport(db, { from, to }) {
  const where = [];
  const params = [];
  if (from) {
    params.push(from);
    where.push(`e.join_date >= $${params.length}::date`);
  }
  if (to) {
    params.push(to);
    where.push(`e.join_date <= $${params.length}::date`);
  }
  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

  const { rows } = await db.query(
    `SELECT e.id, c.candidate_code, c.full_name, p.name AS position, e.join_date,
            e.track, e.current_phase, e.status
       FROM employees e
       JOIN candidates c ON c.id = e.candidate_id
       LEFT JOIN positions p ON p.id = c.position_id
      ${whereSql}
      ORDER BY e.join_date DESC, e.id DESC`,
    params,
  );
  return rows.map((row) => ({
    id: Number(row.id),
    candidateCode: row.candidate_code,
    fullName: row.full_name,
    position: row.position,
    joinDate: row.join_date,
    track: row.track,
    currentPhase: row.current_phase,
    status: row.status,
  }));
}

export async function exitReport(db, { from, to }) {
  const where = [`e.status IN ('discontinued', 'terminated')`];
  const params = [];
  if (from) {
    params.push(from);
    where.push(`e.exit_date >= $${params.length}::date`);
  }
  if (to) {
    params.push(to);
    where.push(`e.exit_date <= $${params.length}::date`);
  }

  const { rows } = await db.query(
    `SELECT e.id, c.candidate_code, c.full_name, p.name AS position, e.join_date,
            e.status, e.exit_date, e.exit_reason
       FROM employees e
       JOIN candidates c ON c.id = e.candidate_id
       LEFT JOIN positions p ON p.id = c.position_id
      WHERE ${where.join(' AND ')}
      ORDER BY e.exit_date DESC, e.id DESC`,
    params,
  );
  return rows.map((row) => ({
    id: Number(row.id),
    candidateCode: row.candidate_code,
    fullName: row.full_name,
    position: row.position,
    joinDate: row.join_date,
    status: row.status,
    exitDate: row.exit_date,
    exitReason: row.exit_reason,
  }));
}
