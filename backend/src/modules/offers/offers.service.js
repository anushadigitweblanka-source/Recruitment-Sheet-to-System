import { inTransaction } from '../../db/transaction.js';
import { recordAudit } from '../audit/audit.js';
import { createEmployeeOnJoin, employeeIdForCandidate } from '../employees/employees.service.js';
import { changeStage, lockPipeline } from '../pipeline/pipeline.js';
import {
  EDITABLE_COLUMNS,
  findOffer,
  findPosition,
  insertOffer,
  offerIdForCandidate,
  updateOffer,
} from './offers.repository.js';
import { validateOffer } from './offers.validation.js';

// Every function here returns one of:
//   { ok: true, data }                               data = candidate + offer
//   { ok: false, reason: 'validation', fields }
//   { ok: false, reason: 'not_found' }
//   { ok: false, reason: 'already_exists', offerId }

// The stage an offer puts the candidate in, using the stage names from the
// task guide's list. An offer that has not been sent yet has no say.
export function stageFor({ offerStatus, attended }) {
  if (attended === true) return 'joined';
  if (offerStatus === 'accepted') return 'offer_accepted';
  if (offerStatus === 'sent') return 'offer_sent';
  return null;
}

// "Selected goes to Offer Tracker": an offer is created for a candidate whose
// direct interview ended in Selected.
const STAGE_BEFORE_OFFER = 'selected';

// The stages the offer itself can put a candidate in, and so may move them
// out of again when a mistake is corrected.
const STAGES_OFFER_CAN_LEAVE = [STAGE_BEFORE_OFFER, 'offer_sent', 'offer_accepted', 'joined'];

const invalid = (fields) => ({ ok: false, reason: 'validation', fields });

// The offer fields an employee record is created from.
const JOINING_FIELDS = ['offerStatus', 'onboardingDate', 'attended'];

// "Attended = Yes creates the employee and the 7-day evaluation" (Module 5).
// Runs inside the offer's transaction; a second call never adds a second employee.
async function createEmployeeIfJoined(db, { candidateId, values, user }) {
  if (values.attended === true) {
    await createEmployeeOnJoin(db, { candidateId, joinDate: values.onboardingDate, user });
  }
}

// Applies whatever stage change this save causes. Returns { error } when the
// change must be refused.
async function applyOutcome(db, { candidateId, pipeline, before, after, user }) {
  const newStage = stageFor(after);
  const outcomeChanged = !before || stageFor(before) !== newStage;
  // Clearing a status that had been recorded puts the candidate back to Selected.
  const toStage = outcomeChanged ? (newStage ?? (before ? STAGE_BEFORE_OFFER : null)) : null;
  if (!toStage || toStage === pipeline.stage) return {};

  if (!STAGES_OFFER_CAN_LEAVE.includes(pipeline.stage)) {
    return {
      error: `This candidate is at "${pipeline.stageName}", so the offer can no longer change their stage.`,
    };
  }
  await changeStage(db, {
    candidateId,
    fromStage: pipeline.stage,
    toStage,
    userId: user.id,
    source: 'offer',
  });
  return {};
}

// Runs `work` in a transaction. A refused stage change throws inside it, which
// undoes everything already written, and is reported as a field error.
function saving(pool, work) {
  return inTransaction(pool, work).catch((err) => {
    if (err.refusedResult) return invalid({ offerStatus: err.message });
    throw err;
  });
}
const refuse = (message) => Object.assign(new Error(message), { refusedResult: true });

// The acceptance checklist's "Selecting 'Selected' in the interview must
// create an offer row automatically". Runs inside the direct interview's
// transaction, after the stage change to "Selected"; a second call never adds
// a second offer. The row holds only what is known: the candidate and their
// applied position. Offer date, work mode, location, status, onboarding date
// and attendance stay empty until someone records them - nothing is invented,
// and no salary exists anywhere. A candidate without an applied position gets
// no automatic row (offers.position_id cannot be empty, and choosing a
// position for them would be inventing data): they stay at "Selected" in the
// offer tracker until an offer is created by hand.
export async function createOfferOnSelection(db, { candidateId, user }) {
  const existing = await offerIdForCandidate(db, candidateId);
  if (existing) return existing;

  const { rows } = await db.query('SELECT position_id FROM candidates WHERE id = $1', [
    candidateId,
  ]);
  if (!rows[0]?.position_id) return null;
  const positionId = Number(rows[0].position_id);

  const id = await insertOffer(
    db,
    candidateId,
    {
      positionId,
      offerDate: null,
      workMode: null,
      location: null,
      offerStatus: null,
      onboardingDate: null,
      attended: null,
    },
    user.id,
  );
  await recordAudit(db, {
    actorUserId: user.id,
    action: 'OFFER_CREATE',
    entityType: 'offers',
    entityId: id,
    newValues: { candidateId, positionId },
    details: { source: 'direct_interview' },
  });
  return id;
}

export async function createOffer(pool, user, input) {
  const candidateId = Number(input?.candidateId);
  if (!Number.isInteger(candidateId) || candidateId < 1) {
    return invalid({ candidateId: 'A candidate must be chosen.' });
  }

  const { values, errors } = validateOffer(input);
  if (Object.keys(errors).length > 0) return invalid(errors);

  const outcome = await saving(pool, async (db) => {
    const pipeline = await lockPipeline(db, candidateId);
    if (!pipeline) return invalid({ candidateId: 'This candidate does not exist.' });

    // One offer per candidate for now. Whether a second offer gets its own
    // record is not confirmed; the table allows it, this check can be lifted.
    const existingId = await offerIdForCandidate(db, candidateId);
    if (existingId) return { ok: false, reason: 'already_exists', offerId: existingId };

    if (pipeline.stage !== STAGE_BEFORE_OFFER) {
      return invalid({
        candidateId: `An offer can be created once the candidate's direct interview result is "Selected". This candidate is at "${pipeline.stageName}".`,
      });
    }

    const position = await findPosition(db, values.positionId);
    if (!position) return invalid({ positionId: 'This position does not exist.' });
    if (!position.isActive) return invalid({ positionId: 'This position is no longer in use.' });

    const id = await insertOffer(db, candidateId, values, user.id);
    await recordAudit(db, {
      actorUserId: user.id,
      action: 'OFFER_CREATE',
      entityType: 'offers',
      entityId: id,
      newValues: { candidateId, ...values },
    });

    const applied = await applyOutcome(db, {
      candidateId,
      pipeline,
      before: null,
      after: values,
      user,
    });
    if (applied.error) throw refuse(applied.error);
    await createEmployeeIfJoined(db, { candidateId, values, user });
    return { ok: true, id };
  });

  if (!outcome.ok) return outcome;
  return { ok: true, data: await findOffer(pool, outcome.id) };
}

export async function editOffer(pool, user, id, input) {
  const current = await findOffer(pool, id);
  if (!current) return { ok: false, reason: 'not_found' };
  const candidateId = current.candidate.id;

  // A PATCH may send only some fields; the rest keep their current values.
  const existing = Object.fromEntries(
    Object.keys(EDITABLE_COLUMNS).map((name) => [name, current.offer[name]]),
  );
  const { values, errors } = validateOffer({ ...existing, ...(input ?? {}) });
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

    // Once the employee record exists, the joining it was created from is
    // settled: its lifecycle dates start from this onboarding date.
    if (
      JOINING_FIELDS.some((name) => name in changes) &&
      (await employeeIdForCandidate(db, candidateId))
    ) {
      throw refuse(
        'An employee record has been created from this offer, so its status, onboarding date and attendance can no longer be changed.',
      );
    }

    // The position already on the offer stays valid even if it was switched
    // off since; a newly chosen one must be in use.
    if ('positionId' in changes) {
      const position = await findPosition(db, changes.positionId);
      if (!position) return invalid({ positionId: 'This position does not exist.' });
      if (!position.isActive) return invalid({ positionId: 'This position is no longer in use.' });
    }

    if (Object.keys(changes).length > 0) {
      await updateOffer(db, id, changes, user.id);
      await recordAudit(db, {
        actorUserId: user.id,
        action: 'OFFER_UPDATE',
        entityType: 'offers',
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
      user,
    });
    if (applied.error) throw refuse(applied.error);
    await createEmployeeIfJoined(db, { candidateId, values, user });
    return { ok: true };
  });

  if (!outcome.ok) return outcome;
  return { ok: true, data: await findOffer(pool, id) };
}
