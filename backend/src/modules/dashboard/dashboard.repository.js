// All SQL for the dashboard. Read-only: nothing here writes.
//
// Query basis for each figure:
//   totalCandidates      count of candidates rows
//   stage counts         pipeline_status.current_stage - one row per candidate
//                        (primary key candidate_id), so a candidate is counted
//                        once, in the stage they are in NOW. History rows in
//                        stage_history are deliberately not counted.
//   currentlyWorking     employees with status 'active'
//   discontinued         employees with status 'discontinued'
//   terminated           employees with status 'terminated'
//   employeePhases       active employees grouped by current_phase - the copy
//                        Module 5 keeps in step with phase_history, so no
//                        historical phase row is ever counted as current.
//   upcomingInterviews   direct interviews whose scheduled_at is in the
//                        future, nearest first.
//   upcomingDeadlines    active employees whose stored phase_end falls within
//                        the next 7 days. The dates were written by Module 5's
//                        approved calculations; nothing is recalculated here.
//                        A junior with no end date (9-month rule unconfirmed)
//                        has phase_end NULL and is simply excluded. Senior has
//                        no end date and never appears.

// Maps pipeline stage codes to the dashboard's count names.
const STAGE_COUNT_NAMES = {
  applied: 'applied',
  phone_screened: 'phoneScreened',
  interview_scheduled: 'interviewsScheduled',
  interviewed: 'interviewed',
  selected: 'selected',
  rejected: 'rejected',
  on_hold: 'onHold',
  offer_sent: 'offersSent',
  offer_accepted: 'offersAccepted',
  joined: 'joined',
  not_attended: 'notAttended',
  no_response: 'noResponse',
};

export async function readCounts(db) {
  const counts = {
    totalCandidates: 0,
    ...Object.fromEntries(Object.values(STAGE_COUNT_NAMES).map((name) => [name, 0])),
    currentlyWorking: 0,
    discontinued: 0,
    terminated: 0,
  };

  const total = await db.query('SELECT count(*)::int AS total FROM candidates');
  counts.totalCandidates = total.rows[0].total;

  const stages = await db.query(
    'SELECT current_stage, count(*)::int AS total FROM pipeline_status GROUP BY current_stage',
  );
  for (const row of stages.rows) {
    const name = STAGE_COUNT_NAMES[row.current_stage];
    if (name) counts[name] = row.total;
  }

  const employees = await db.query(
    'SELECT status, count(*)::int AS total FROM employees GROUP BY status',
  );
  for (const row of employees.rows) {
    if (row.status === 'active') counts.currentlyWorking = row.total;
    if (row.status === 'discontinued') counts.discontinued = row.total;
    if (row.status === 'terminated') counts.terminated = row.total;
  }

  return counts;
}

// The Recruitment Records figures, matching the Candidate List: the imported
// historical interview records plus the current candidate profiles.
//
// A historical record is one line of an old interview log, NOT a unique person,
// so it is counted as an interview record and never as a candidate. Its outcome
// is the status text exactly as imported (grouped by that exact text, a blank
// cell shown as null); it is never mapped onto a live pipeline stage, and the
// live stage counts above never include it. Only completed (not rolled back)
// import batches count. Counts only - no name, phone or remark is selected.
// Returns null in a database that has no historical tables.
export async function readRecruitmentRecords(db) {
  const exists = await db.query(
    `SELECT to_regclass('historical_interview_records') IS NOT NULL
        AND to_regclass('historical_import_batches') IS NOT NULL AS ok`,
  );
  if (!exists.rows[0].ok) return null;

  const profiles = await db.query('SELECT count(*)::int AS total FROM candidates');
  const outcomes = await db.query(
    `SELECT r.original_status AS status, count(*)::int AS total
       FROM historical_interview_records r
       JOIN historical_import_batches b ON b.id = r.batch_id
      WHERE b.status = 'completed'
      GROUP BY r.original_status
      ORDER BY count(*) DESC, r.original_status NULLS LAST`,
  );
  const historical = outcomes.rows.reduce((sum, row) => sum + row.total, 0);
  const currentProfiles = profiles.rows[0].total;
  return {
    totalRecords: historical + currentProfiles,
    historicalInterviewRecords: historical,
    currentCandidateProfiles: currentProfiles,
    historicalOutcomes: outcomes.rows.map((row) => ({ status: row.status, count: row.total })),
  };
}

export async function readEmployeePhases(db) {
  const phases = { evaluation: 0, probation: 0, junior: 0, senior: 0 };
  const { rows } = await db.query(
    `SELECT current_phase, count(*)::int AS total
       FROM employees WHERE status = 'active' GROUP BY current_phase`,
  );
  for (const row of rows) {
    if (row.current_phase in phases) phases[row.current_phase] = row.total;
  }
  return phases;
}

export async function readUpcomingInterviews(db, limit = 10) {
  const { rows } = await db.query(
    `SELECT i.id, c.candidate_code, c.full_name, p.name AS position, i.scheduled_at,
            i.interviewer_name, s.name AS stage
       FROM interviews i
       JOIN candidates c ON c.id = i.candidate_id
       LEFT JOIN positions p ON p.id = c.position_id
       LEFT JOIN pipeline_status ps ON ps.candidate_id = c.id
       LEFT JOIN pipeline_stages s ON s.code = ps.current_stage
      WHERE i.scheduled_at >= now()
      ORDER BY i.scheduled_at, i.id
      LIMIT $1`,
    [limit],
  );
  return rows.map((row) => ({
    id: Number(row.id),
    candidateCode: row.candidate_code,
    candidateName: row.full_name,
    position: row.position,
    scheduledAt: row.scheduled_at,
    interviewer: row.interviewer_name,
    stage: row.stage,
  }));
}

export async function readUpcomingDeadlines(db, days = 7) {
  const { rows } = await db.query(
    `SELECT e.id, c.candidate_code, c.full_name, p.name AS position, e.current_phase,
            e.phase_end, (e.phase_end - current_date)::int AS days_remaining
       FROM employees e
       JOIN candidates c ON c.id = e.candidate_id
       LEFT JOIN positions p ON p.id = c.position_id
      WHERE e.status = 'active'
        AND e.phase_end IS NOT NULL
        AND e.phase_end >= current_date
        AND e.phase_end <= current_date + $1::int
      ORDER BY e.phase_end, e.id`,
    [days],
  );
  return rows.map((row) => ({
    id: Number(row.id),
    candidateCode: row.candidate_code,
    employeeName: row.full_name,
    position: row.position,
    phase: row.current_phase,
    endDate: row.phase_end,
    daysRemaining: row.days_remaining,
  }));
}
