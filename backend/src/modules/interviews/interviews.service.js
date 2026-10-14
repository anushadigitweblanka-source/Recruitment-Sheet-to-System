import { inTransaction } from '../../db/transaction.js';
import { recordAudit } from '../audit/audit.js';
import {
  changeStage,
  lockPipeline,
  updateHoldDetails,
  updateRejectReason,
} from '../pipeline/pipeline.js';
import {
  EDITABLE_COLUMNS,
  findInterview,
  insertInterview,
  interviewIdForCandidate,
  updateInterview,
} from './interviews.repository.js';
import { validateInterview } from './interviews.validation.js';

// Every function here returns one of:
//   { ok: true, data }                               data = candidate + interview
//   { ok: false, reason: 'validation', fields }
//   { ok: false, reason: 'not_found' }
//   { ok: false, reason: 'already_exists', interviewId }

// The stage a direct interview puts the candidate in. From the task guide:
// "Selected goes to Offer Tracker, Not Selected to the Rejected sheet, On Hold
// to the On Hold sheet", with the stage names from its stage list. Nothing
// recorded yet means the interview has no say.
export function stageFor({ decision, attendance }) {
  if (decision === 'selected') return 'selected';
  if (decision === 'not_selected') return 'rejected';
  if (decision === 'on_hold') return 'on_hold';
  if (attendance === 'attended') return 'interviewed';
  if (attendance === 'not_attended') return 'not_attended';
  return null;
}

// A direct interview is recorded for a candidate who is waiting for one.
const STAGE_BEFORE_INTERVIEW = 'interview_scheduled';

// The stages the interview itself can put a candidate in, and so may move them
// out of again. Once later steps have moved the candidate on (an offer, or
// joining), changing the interview must not pull them back.
const STAGES_INTERVIEW_CAN_LEAVE = [
  STAGE_BEFORE_INTERVIEW,
  'interviewed',
  'selected',
  'on_hold',
  'rejected',
  'not_attended',
];

const invalid = (fields) => ({ ok: false, reason: 'validation', fields });

const reasonFor = (stage, reasons) =>
  stage === 'rejected' ? reasons.rejectReason : stage === 'on_hold' ? reasons.holdReason : null;

// Applies whatever stage change this save causes. Returns { error } when the
// change must be refused.
async function applyOutcome(db, { candidateId, pipeline, before, after, reasons, user }) {
  const newStage = stageFor(after);
  const outcomeChanged = !before || stageFor(before) !== newStage;
  // Clearing everything that had been recorded puts the candidate back to waiting.
  const toStage = outcomeChanged ? (newStage ?? (before ? STAGE_BEFORE_INTERVIEW : null)) : null;

  if (toStage && toStage !== pipeline.stage) {
    if (!STAGES_INTERVIEW_CAN_LEAVE.includes(pipeline.stage)) {
      return {
        error: `This candidate has already moved on to "${pipeline.stageName}", so the interview result can no longer be changed.`,
      };
    }
    await changeStage(db, {
      candidateId,
      fromStage: pipeline.stage,
      toStage,
      reason: reasonFor(toStage, reasons),
      nextFollowupDate: reasons.nextFollowupDate,
      userId: user.id,
      source: 'direct_interview',
    });
    return {};
  }

  // Same stage as before, but a reason or the follow-up date was corrected.
  if (pipeline.stage === 'rejected' && after.decision === 'not_selected') {
    if (reasons.rejectReason !== pipeline.rejectReason) {
      await updateRejectReason(db, { candidateId, reason: reasons.rejectReason, userId: user.id });
    }
  } else if (pipeline.stage === 'on_hold' && after.decision === 'on_hold') {
    if (
      reasons.holdReason !== pipeline.holdReason ||
      reasons.nextFollowupDate !== pipeline.nextFollowupDate
    ) {
      await updateHoldDetails(db, {
        candidateId,
        reason: reasons.holdReason,
        nextFollowupDate: reasons.nextFollowupDate,
        userId: user.id,
      });
    }
  }
  return {};
}

// Runs `work` in a transaction. A refused stage change throws inside it, which
// undoes everything already written, and is reported as a field error.
function saving(pool, work) {
  return inTransaction(pool, work).catch((err) => {
    if (err.refusedResult) return invalid({ decision: err.message });
    throw err;
  });
}
const refuse = (message) => Object.assign(new Error(message), { refusedResult: true });

export async function createInterview(pool, user, input) {
  const candidateId = Number(input?.candidateId);
  if (!Number.isInteger(candidateId) || candidateId < 1) {
    return invalid({ candidateId: 'A candidate must be chosen.' });
  }

  const { values, reasons, errors } = validateInterview(input);
  if (Object.keys(errors).length > 0) return invalid(errors);

  const outcome = await saving(pool, async (db) => {
    const pipeline = await lockPipeline(db, candidateId);
    if (!pipeline) return invalid({ candidateId: 'This candidate does not exist.' });

    // One record per candidate for now. Whether a repeat interview gets its
    // own record is not confirmed; the table allows it, this check can be lifted.
    const existingId = await interviewIdForCandidate(db, candidateId);
    if (existingId) return { ok: false, reason: 'already_exists', interviewId: existingId };

    if (pipeline.stage !== STAGE_BEFORE_INTERVIEW) {
      return invalid({
        candidateId: `A direct interview can be recorded once the candidate is at "Interview Scheduled". This candidate is at "${pipeline.stageName}".`,
      });
    }

    const id = await insertInterview(db, candidateId, values, user.id);
    await recordAudit(db, {
      actorUserId: user.id,
      action: 'INTERVIEW_CREATE',
      entityType: 'interviews',
      entityId: id,
      newValues: { candidateId, ...values },
    });

    const applied = await applyOutcome(db, {
      candidateId,
      pipeline,
      before: null,
      after: values,
      reasons,
      user,
    });
    if (applied.error) throw refuse(applied.error);
    return { ok: true, id };
  });

  if (!outcome.ok) return outcome;
  return { ok: true, data: await findInterview(pool, outcome.id) };
}

export async function editInterview(pool, user, id, input) {
  const current = await findInterview(pool, id);
  if (!current) return { ok: false, reason: 'not_found' };
  const candidateId = current.candidate.id;

  // A PATCH may send only some fields; the rest keep their current values.
  const existing = Object.fromEntries(
    Object.keys(EDITABLE_COLUMNS).map((name) => [name, current.interview[name]]),
  );
  const merged = {
    ...existing,
    holdReason: current.holdReason,
    rejectReason: current.rejectReason,
    nextFollowupDate: current.nextFollowupDate,
    ...(input ?? {}),
  };
  const { values, reasons, errors } = validateInterview(merged);
  if (Object.keys(errors).length > 0) return invalid(errors);

  const changes = {};
  const before = {};
  for (const name of Object.keys(EDITABLE_COLUMNS)) {
    if (values[name] !== existing[name]) {
      changes[name] = values[name];
      before[name] = existing[name];
    }
  }

  const outcome = await saving(pool, async (db) => {
    const pipeline = await lockPipeline(db, candidateId);

    if (Object.keys(changes).length > 0) {
      await updateInterview(db, id, changes, user.id);
      await recordAudit(db, {
        actorUserId: user.id,
        action: 'INTERVIEW_UPDATE',
        entityType: 'interviews',
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
      reasons,
      user,
    });
    if (applied.error) throw refuse(applied.error);
    return { ok: true };
  });

  if (!outcome.ok) return outcome;
  return { ok: true, data: await findInterview(pool, id) };
}
