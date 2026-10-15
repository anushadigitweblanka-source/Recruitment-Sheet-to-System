import { teamScopeClause } from '../team-leads/teamScope.js';

// All SQL for direct interviews. `db` is the pool, or a client inside a transaction.

// API field name -> column name, for the fields a user can set.
// total_score is not here: the database works it out and refuses any attempt to set it.
export const EDITABLE_COLUMNS = {
  scheduledAt: 'scheduled_at',
  attendance: 'attendance',
  interviewerName: 'interviewer_name',
  scoreTechnical: 'score_technical',
  scoreAi: 'score_ai',
  scoreCommunication: 'score_communication',
  scoreConfidence: 'score_confidence',
  scoreCultureFit: 'score_culture_fit',
  recommendation: 'recommendation',
  decision: 'decision',
  remarks: 'remarks',
};

const escapeLike = (text) => text.replace(/[\\%_]/g, '\\$&');
const iso = (value) => (value ? value.toISOString() : null);

function toCandidateSummary(row) {
  return {
    id: Number(row.candidate_id),
    candidateCode: row.candidate_code,
    fullName: row.full_name,
    phone: row.phone,
    position: row.position_name ?? null,
    stage: { code: row.current_stage, name: row.stage_name },
    // "Interview screen shows Company CV link"; CV pending is shown to HR and the Team Lead.
    companyCvUrl: row.company_cv_url ?? null,
    companyCvStatus: row.company_cv_status,
    companyCvPending: ['sent', 'overdue'].includes(row.company_cv_status),
    teamLead: row.team_lead_name ?? null,
  };
}

// The candidates the direct interview list is about: anyone who already has
// an interview, plus anyone waiting for one (stage "Interview Scheduled").
// "Latest" interview, so this keeps working if repeat interviews are allowed.
const FROM_CANDIDATES = `
  FROM candidates c
  JOIN pipeline_status ps ON ps.candidate_id = c.id
  JOIN pipeline_stages st ON st.code = ps.current_stage
  LEFT JOIN LATERAL (
    SELECT * FROM interviews x WHERE x.candidate_id = c.id ORDER BY x.id DESC LIMIT 1
  ) i ON true
  LEFT JOIN LATERAL (
    SELECT x.interview_datetime FROM phone_screens x
     WHERE x.candidate_id = c.id ORDER BY x.id DESC LIMIT 1
  ) ph ON true`;

export async function listInterviews(db, filters, scope = null) {
  const where = [`(i.id IS NOT NULL OR ps.current_stage = 'interview_scheduled')`];
  const params = [];
  const add = (value) => {
    params.push(value);
    return `$${params.length}`;
  };
  if (scope) where.push(teamScopeClause(add(scope.userId)));

  if (filters.search) {
    const pattern = add(`%${escapeLike(filters.search)}%`);
    where.push(`(c.full_name ILIKE ${pattern} OR c.candidate_code ILIKE ${pattern})`);
  }
  if (filters.attendance === 'pending') where.push('i.attendance IS NULL');
  else if (filters.attendance) where.push(`i.attendance = ${add(filters.attendance)}`);
  if (filters.decision === 'pending') where.push('i.decision IS NULL');
  else if (filters.decision) where.push(`i.decision = ${add(filters.decision)}`);

  const whereSql = `WHERE ${where.join(' AND ')}`;
  const total = await db.query(
    `SELECT count(*)::int AS total ${FROM_CANDIDATES} ${whereSql}`,
    params,
  );

  const limit = add(filters.pageSize);
  const offset = add((filters.page - 1) * filters.pageSize);
  const { rows } = await db.query(
    `SELECT c.id AS candidate_id, c.candidate_code, c.full_name, c.phone,
            c.company_cv_url, c.company_cv_status,
            ps.current_stage, st.name AS stage_name,
            i.id AS interview_id, i.scheduled_at, i.attendance, i.interviewer_name,
            i.total_score, i.recommendation, i.decision,
            ph.interview_datetime AS planned_at
     ${FROM_CANDIDATES}
     ${whereSql}
     ORDER BY COALESCE(i.scheduled_at, ph.interview_datetime) DESC NULLS LAST, c.id DESC
     LIMIT ${limit} OFFSET ${offset}`,
    params,
  );

  return {
    items: rows.map((row) => ({
      candidate: {
        id: Number(row.candidate_id),
        candidateCode: row.candidate_code,
        fullName: row.full_name,
        stage: { code: row.current_stage, name: row.stage_name },
        companyCvUrl: row.company_cv_url,
        companyCvStatus: row.company_cv_status,
        companyCvPending: ['sent', 'overdue'].includes(row.company_cv_status),
      },
      interview: row.interview_id
        ? {
            id: Number(row.interview_id),
            scheduledAt: iso(row.scheduled_at),
            attendance: row.attendance,
            interviewerName: row.interviewer_name,
            totalScore: row.total_score,
            recommendation: row.recommendation,
            decision: row.decision,
          }
        : null,
      // The slot agreed in the phone interview, for a candidate not yet interviewed.
      plannedAt: iso(row.planned_at),
    })),
    total: total.rows[0].total,
  };
}

// One interview with its candidate and the reasons kept on the pipeline status.
export async function findInterview(db, id, scope = null) {
  const { rows } = await db.query(
    `SELECT i.*, c.candidate_code, c.full_name, c.phone, p.name AS position_name,
            c.company_cv_url, c.company_cv_status, tl.name AS team_lead_name,
            ps.current_stage, st.name AS stage_name, ps.hold_reason, ps.reject_reason,
            to_char(ps.next_followup_date, 'YYYY-MM-DD') AS next_followup_date,
            uu.full_name AS updated_by_name
       FROM interviews i
       JOIN candidates c ON c.id = i.candidate_id
       JOIN pipeline_status ps ON ps.candidate_id = c.id
       JOIN pipeline_stages st ON st.code = ps.current_stage
       LEFT JOIN positions p ON p.id = c.position_id
       LEFT JOIN team_leads tl ON tl.position_id = c.position_id AND tl.is_active
       LEFT JOIN users uu ON uu.id = i.updated_by
      WHERE i.id = $1${scope ? ` AND ${teamScopeClause('$2')}` : ''}`,
    scope ? [id, scope.userId] : [id],
  );
  if (rows.length === 0) return null;
  const row = rows[0];
  const onHold = row.current_stage === 'on_hold';

  return {
    candidate: toCandidateSummary(row),
    interview: {
      id: Number(row.id),
      scheduledAt: iso(row.scheduled_at),
      attendance: row.attendance,
      interviewerName: row.interviewer_name,
      scoreTechnical: row.score_technical,
      scoreAi: row.score_ai,
      scoreCommunication: row.score_communication,
      scoreConfidence: row.score_confidence,
      scoreCultureFit: row.score_culture_fit,
      totalScore: row.total_score,
      recommendation: row.recommendation,
      decision: row.decision,
      remarks: row.remarks,
      updatedAt: row.updated_at,
      updatedBy: row.updated_by_name,
    },
    // Shown and edited on the form while they apply.
    holdReason: onHold ? row.hold_reason : null,
    nextFollowupDate: onHold ? row.next_followup_date : null,
    rejectReason: row.current_stage === 'rejected' ? row.reject_reason : null,
  };
}

export async function interviewIdForCandidate(db, candidateId) {
  const { rows } = await db.query(
    'SELECT id FROM interviews WHERE candidate_id = $1 ORDER BY id DESC LIMIT 1',
    [candidateId],
  );
  return rows[0] ? Number(rows[0].id) : null;
}

export async function insertInterview(db, candidateId, values, userId) {
  const names = Object.keys(EDITABLE_COLUMNS);
  const { rows } = await db.query(
    `INSERT INTO interviews (candidate_id, ${names.map((n) => EDITABLE_COLUMNS[n]).join(', ')}, created_by, updated_by)
     VALUES ($1, ${names.map((_, i) => `$${i + 2}`).join(', ')}, $${names.length + 2}, $${names.length + 2})
     RETURNING id`,
    [candidateId, ...names.map((n) => values[n]), userId],
  );
  return Number(rows[0].id);
}

export async function updateInterview(db, id, changes, userId) {
  const names = Object.keys(changes);
  await db.query(
    `UPDATE interviews
        SET ${names.map((n, i) => `${EDITABLE_COLUMNS[n]} = $${i + 1}`).join(', ')},
            updated_at = now(), updated_by = $${names.length + 1}
      WHERE id = $${names.length + 2}`,
    [...names.map((n) => changes[n]), userId, id],
  );
}
