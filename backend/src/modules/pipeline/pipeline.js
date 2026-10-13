import { recordAudit } from '../audit/audit.js';

// The one place that moves a candidate from one pipeline stage to another.
// Every module that changes a stage goes through here, so the current stage,
// the stage history and the audit log can never disagree.
//
// All functions must be called inside a transaction (`db` is its client).

// Reads the candidate's current stage and holds the row until the transaction
// ends, so two people saving at the same moment are handled one after the other.
// Returns null when the candidate does not exist.
export async function lockPipeline(db, candidateId) {
  const { rows } = await db.query(
    `SELECT ps.current_stage, ps.reject_reason, st.name AS stage_name
       FROM pipeline_status ps
       JOIN pipeline_stages st ON st.code = ps.current_stage
      WHERE ps.candidate_id = $1
        FOR UPDATE OF ps`,
    [candidateId],
  );
  if (rows.length === 0) return null;
  return {
    stage: rows[0].current_stage,
    stageName: rows[0].stage_name,
    rejectReason: rows[0].reject_reason,
  };
}

// Moves the candidate to `toStage`. The earlier stage is never overwritten:
// a new stage_history row is added each time. Returns false when the candidate
// is already in that stage (nothing is written).
//
// reason: required by the database when the stage is "rejected" or "on_hold".
// source: which part of the application made the change, for the audit log.
export async function changeStage(
  db,
  { candidateId, fromStage, toStage, reason = null, userId, source },
) {
  if (fromStage === toStage) return false;

  await db.query(
    `UPDATE pipeline_status
        SET current_stage = $2,
            reject_reason = CASE WHEN $2 = 'rejected' THEN $3 ELSE NULL END,
            hold_reason = CASE WHEN $2 = 'on_hold' THEN $3 ELSE NULL END,
            stage_changed_at = now(),
            updated_by = $4
      WHERE candidate_id = $1`,
    [candidateId, toStage, reason, userId],
  );
  await db.query(
    `INSERT INTO stage_history (candidate_id, from_stage, to_stage, reason, changed_by)
     VALUES ($1, $2, $3, $4, $5)`,
    [candidateId, fromStage, toStage, reason, userId],
  );
  await recordAudit(db, {
    actorUserId: userId,
    action: 'PIPELINE_STAGE_CHANGE',
    entityType: 'candidates',
    entityId: candidateId,
    oldValues: { stage: fromStage },
    newValues: { stage: toStage },
    details: { source, ...(reason ? { reason } : {}) },
  });
  return true;
}

// Corrects the wording of a rejection reason without changing the stage.
export async function updateRejectReason(db, { candidateId, reason, userId }) {
  await db.query(
    `UPDATE pipeline_status SET reject_reason = $2, updated_by = $3
      WHERE candidate_id = $1 AND current_stage = 'rejected'`,
    [candidateId, reason, userId],
  );
}
