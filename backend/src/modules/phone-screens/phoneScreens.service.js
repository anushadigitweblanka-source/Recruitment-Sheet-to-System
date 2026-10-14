import { inTransaction } from '../../db/transaction.js';
import { recordAudit } from '../audit/audit.js';
import { changeStage, lockPipeline, updateRejectReason } from '../pipeline/pipeline.js';
import {
  EDITABLE_COLUMNS,
  findForCandidate,
  findScreenById,
  insertScreen,
  screenIdForCandidate,
  updateScreen,
} from './phoneScreens.repository.js';
import { validatePhoneScreen } from './phoneScreens.validation.js';

// Every function here returns one of:
//   { ok: true, data }                               data = candidate + phone interview
//   { ok: false, reason: 'validation', fields }
//   { ok: false, reason: 'not_found' }
//   { ok: false, reason: 'already_exists', candidateId }

// The stage a phone interview outcome puts the candidate in. Based on the task
// guide ("Selected moves the candidate to Direct Interview automatically") and
// its stage list. No outcome yet means the phone interview has no say.
export function stageFor({ result, interviewAt }) {
  if (result === 'selected') return interviewAt ? 'interview_scheduled' : 'phone_screened';
  if (result === 'not_selected') return 'rejected';
  return null;
}

// The phone interview may only move a candidate who is still at, or was put
// in, one of these stages. Once later steps have moved the candidate on (for
// example to Interviewed or Offer Sent), changing the phone result must not
// pull them back.
const STAGES_PHONE_INTERVIEW_CAN_LEAVE = [
  'applied',
  'phone_screened',
  'interview_scheduled',
  'rejected',
  'no_response',
];

const invalid = (fields) => ({ ok: false, reason: 'validation', fields });

// Works out the stage change this save causes, if any.
// Returns { toStage } (null = leave the stage alone) or { error }.
function planStageChange({ pipeline, before, after }) {
  const newStage = stageFor(after);
  // On an edit, nothing moves unless the outcome itself changed.
  if (before && stageFor(before) === newStage) return { toStage: null };

  // Clearing a result that had been recorded puts the candidate back to Applied.
  const toStage = newStage ?? (before ? 'applied' : null);
  if (!toStage || toStage === pipeline.stage) return { toStage: null };

  if (!STAGES_PHONE_INTERVIEW_CAN_LEAVE.includes(pipeline.stage)) {
    return {
      error: `This candidate has already moved on to "${pipeline.stageName}", so the phone interview result can no longer be changed.`,
    };
  }
  return { toStage };
}

async function applyOutcome(db, { candidateId, pipeline, before, after, rejectReason, user }) {
  const plan = planStageChange({ pipeline, before, after });
  if (plan.error) return plan;

  // Once a direct interview has been recorded, the phone interview's outcome
  // is settled: the candidate was selected and given a slot, and their stage
  // now belongs to the direct interview. Comparing stages is not enough to
  // detect a change here, because both interviews can end in "Rejected".
  const interviewed = await db.query('SELECT 1 FROM interviews WHERE candidate_id = $1 LIMIT 1', [
    candidateId,
  ]);
  if (interviewed.rowCount > 0) {
    const outcomeChanged = stageFor(before ?? {}) !== stageFor(after);
    if (!outcomeChanged) return {};
    return {
      error:
        'A direct interview has been recorded for this candidate, so the phone interview result can no longer be changed.',
    };
  }

  if (plan.toStage) {
    await changeStage(db, {
      candidateId,
      fromStage: pipeline.stage,
      toStage: plan.toStage,
      reason: plan.toStage === 'rejected' ? rejectReason : null,
      userId: user.id,
      source: 'phone_interview',
    });
  } else if (
    pipeline.stage === 'rejected' &&
    after.result === 'not_selected' &&
    rejectReason !== pipeline.rejectReason
  ) {
    // Still rejected, but the wording of the reason was corrected.
    await updateRejectReason(db, { candidateId, reason: rejectReason, userId: user.id });
  }
  return {};
}

export async function createPhoneScreen(pool, user, input) {
  const candidateId = Number(input?.candidateId);
  if (!Number.isInteger(candidateId) || candidateId < 1) {
    return invalid({ candidateId: 'A candidate must be chosen.' });
  }

  const { values, rejectReason, errors } = validatePhoneScreen(input);
  if (Object.keys(errors).length > 0) return invalid(errors);

  const outcome = await inTransaction(pool, async (db) => {
    const pipeline = await lockPipeline(db, candidateId);
    if (!pipeline) return invalid({ candidateId: 'This candidate does not exist.' });

    // One record per candidate for now. Whether repeat attempts get their own
    // records is not confirmed; the table allows it, this check can be lifted.
    if (await screenIdForCandidate(db, candidateId)) {
      return { ok: false, reason: 'already_exists', candidateId };
    }

    const id = await insertScreen(db, candidateId, values, user.id);
    await recordAudit(db, {
      actorUserId: user.id,
      action: 'PHONE_SCREEN_CREATE',
      entityType: 'phone_screens',
      entityId: id,
      newValues: { candidateId, ...values },
    });

    const applied = await applyOutcome(db, {
      candidateId,
      pipeline,
      before: null,
      after: values,
      rejectReason,
      user,
    });
    // Throwing undoes the insert above, so a refused stage change saves nothing.
    if (applied.error) throw Object.assign(new Error(applied.error), { refusedResult: true });
    return { ok: true };
  }).catch((err) => {
    if (err.refusedResult) return invalid({ result: err.message });
    throw err;
  });

  if (!outcome.ok) return outcome;
  return { ok: true, data: await findForCandidate(pool, candidateId) };
}

export async function editPhoneScreen(pool, user, id, input) {
  const existing = await findScreenById(pool, id);
  if (!existing) return { ok: false, reason: 'not_found' };
  const { candidateId } = existing;

  // A PATCH may send only some fields; the rest keep their current values.
  const current = await findForCandidate(pool, candidateId);
  const merged = { ...existing, rejectReason: current.rejectReason, ...(input ?? {}) };
  const { values, rejectReason, errors } = validatePhoneScreen(merged);
  if (Object.keys(errors).length > 0) return invalid(errors);

  const changes = {};
  const before = {};
  for (const name of Object.keys(EDITABLE_COLUMNS)) {
    if (values[name] !== existing[name]) {
      changes[name] = values[name];
      before[name] = existing[name];
    }
  }

  const outcome = await inTransaction(pool, async (db) => {
    const pipeline = await lockPipeline(db, candidateId);

    if (Object.keys(changes).length > 0) {
      await updateScreen(db, id, changes, user.id);
      await recordAudit(db, {
        actorUserId: user.id,
        action: 'PHONE_SCREEN_UPDATE',
        entityType: 'phone_screens',
        entityId: id,
        oldValues: before,
        newValues: changes,
      });
    }

    const applied = await applyOutcome(db, {
      candidateId,
      pipeline,
      before: existing,
      after: values,
      rejectReason,
      user,
    });
    if (applied.error) throw Object.assign(new Error(applied.error), { refusedResult: true });
    return { ok: true };
  }).catch((err) => {
    if (err.refusedResult) return invalid({ result: err.message });
    throw err;
  });

  if (!outcome.ok) return outcome;
  return { ok: true, data: await findForCandidate(pool, candidateId) };
}
