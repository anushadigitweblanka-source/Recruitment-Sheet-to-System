// Creates, replaces and cancels the reminder rows, from the task guide:
//
//   phase end        deadline = end date at 17:30 Asia/Colombo
//   interview        deadline = the interview time
//   joining          deadline = the start of the joining day (Asia/Colombo);
//                    the guide gives a date only, so no time of day is invented
//   send_at          deadline minus 24 hours
//
// A reminder is created when the thing it is about is created (a phase, an
// interview, an onboarding date). A date change cancels the old pending
// reminder and creates a replacement. If send_at has already passed the row is
// simply eligible on the next run of the 15-minute job, which is the guide's
// "send immediately".
//
// Every function takes `db` (a transaction client or the pool) and is meant to
// run inside the same transaction as the change that triggered it.

import { recordAudit } from '../audit/audit.js';
import { loadMailContext, readMailSettings } from './mailContext.js';

const HOUR_MS = 60 * 60 * 1000;

// "End date at 17:30 (office closing, Asia/Colombo)".
export const phaseDeadline = (dateText) => new Date(`${dateText}T17:30:00+05:30`);
export const dayStart = (dateText) => new Date(`${dateText}T00:00:00+05:30`);

const PHASE_NOTIFICATION = {
  evaluation: 'evaluation_end',
  probation: 'probation_end',
  junior: 'junior_end',
};

const unique = (list) => [...new Set(list.filter(Boolean))];

// Cancels the reminders still waiting (or blocked) for one subject. A reminder
// that has already been sent is history and is left as it is.
async function cancelOpen(db, { type, phaseHistoryId, interviewId, offerId, candidateId }) {
  const where = ["status IN ('pending', 'failed')", 'sent_at IS NULL', 'type = $1'];
  const params = [type];
  if (phaseHistoryId) {
    params.push(phaseHistoryId);
    where.push(`phase_history_id = $${params.length}`);
  } else if (interviewId) {
    params.push(interviewId);
    where.push(`interview_id = $${params.length}`);
  } else if (offerId) {
    params.push(offerId);
    where.push(`offer_id = $${params.length}`);
  } else {
    params.push(candidateId);
    where.push(`candidate_id = $${params.length}`);
  }
  const { rows } = await db.query(
    `UPDATE notifications SET status = 'cancelled' WHERE ${where.join(' AND ')} RETURNING id`,
    params,
  );
  return rows.map((row) => Number(row.id));
}

// Writes the reminder. `missing` names required things that are not there; a
// reminder that cannot be sent is kept as a failed row with the reason, so it
// is visible and never silently lost.
async function writeNotification(db, input) {
  const { candidateId, type, subject, dueAt, to, cc = [], missing = [], userId = null } = input;

  // The same reminder (same deadline, same addresses) is left alone.
  const same = await db.query(
    `SELECT id FROM notifications
      WHERE status = 'pending' AND type = $1 AND due_at = $2 AND recipients = $3 AND cc_recipients = $4
        AND candidate_id = $5
        AND phase_history_id IS NOT DISTINCT FROM $6
        AND interview_id IS NOT DISTINCT FROM $7
        AND offer_id IS NOT DISTINCT FROM $8`,
    [
      type,
      dueAt,
      to,
      cc,
      candidateId,
      subject.phaseHistoryId ?? null,
      subject.interviewId ?? null,
      subject.offerId ?? null,
    ],
  );
  if (same.rows[0] && missing.length === 0) {
    return { action: 'unchanged', id: Number(same.rows[0].id) };
  }

  const cancelled = await cancelOpen(db, { type, candidateId, ...subject });
  const blocked = missing.length > 0;
  const sendAt = new Date(dueAt.getTime() - 24 * HOUR_MS);

  const { rows } = await db.query(
    `INSERT INTO notifications
       (candidate_id, type, phase_history_id, interview_id, offer_id, due_at, send_at,
        recipients, cc_recipients, status, last_error)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING id`,
    [
      candidateId,
      type,
      subject.phaseHistoryId ?? null,
      subject.interviewId ?? null,
      subject.offerId ?? null,
      dueAt,
      sendAt,
      to,
      cc,
      blocked ? 'failed' : 'pending',
      blocked ? `Blocked, missing: ${missing.join(', ')}` : null,
    ],
  );
  const id = Number(rows[0].id);

  await recordAudit(db, {
    actorUserId: userId,
    action: blocked ? 'NOTIFICATION_BLOCKED' : 'NOTIFICATION_SCHEDULE',
    entityType: 'notifications',
    entityId: id,
    newValues: { candidateId, type, dueAt: dueAt.toISOString(), sendAt: sendAt.toISOString() },
    details: {
      ...(blocked ? { missing } : {}),
      ...(cancelled.length > 0 ? { replaced: cancelled } : {}),
    },
  });
  return { action: blocked ? 'blocked' : cancelled.length > 0 ? 'replaced' : 'created', id };
}

// ---------------------------------------------------------------------------
// Phase reminders
// ---------------------------------------------------------------------------

// Called when a phase_history row is created. Evaluation: HR + mentor/manager,
// candidate optional. Probation and junior: HR + manager.
export async function schedulePhaseReminder(
  db,
  { candidateId, phaseHistoryId, phase, endDate, userId },
) {
  const type = PHASE_NOTIFICATION[phase];
  // Senior has no end date, and a junior end date is not known until HR
  // enters it (the 9-month rule is not confirmed), so there is nothing to
  // remind about yet.
  if (!type || !endDate) return { action: 'none' };

  const settings = await readMailSettings(db);
  const context = await loadMailContext(db, candidateId);
  const to = [...settings.hrEmails, ...settings.managerEmails];
  if (phase === 'evaluation' && settings.includeCandidateOnEvaluation && context?.email) {
    to.push(context.email);
  }
  const recipients = unique(to);
  const missing = recipients.length === 0 ? ['HR or manager address (Settings)'] : [];

  return writeNotification(db, {
    candidateId,
    type,
    subject: { phaseHistoryId },
    dueAt: phaseDeadline(endDate),
    to: recipients,
    missing,
    userId,
  });
}

// A decided phase no longer needs its reminder.
export async function cancelPhaseReminders(db, { phaseHistoryId, userId = null }) {
  let total = 0;
  for (const type of Object.values(PHASE_NOTIFICATION)) {
    const ids = await cancelOpen(db, { type, phaseHistoryId });
    for (const id of ids) {
      await recordAudit(db, {
        actorUserId: userId,
        action: 'NOTIFICATION_CANCEL',
        entityType: 'notifications',
        entityId: id,
        details: { reason: 'phase decided' },
      });
    }
    total += ids.length;
  }
  return total;
}

// ---------------------------------------------------------------------------
// Interview reminders
// ---------------------------------------------------------------------------

// Interview reminder: 24 hours before, to the candidate and the Team Lead, HR
// copied. Company CV chase: if the Company CV has not arrived by then, the
// candidate is reminded. Both follow the interview time, so a changed time
// replaces them.
export async function scheduleInterviewReminders(
  db,
  { candidateId, interviewId, scheduledAt, userId },
) {
  const dueAt = new Date(scheduledAt);
  const results = {};

  // An interview time already in the past needs no reminder.
  if (dueAt.getTime() <= Date.now()) {
    await cancelOpen(db, { type: 'interview_reminder', candidateId, interviewId });
    await cancelOpen(db, { type: 'cv_pending', candidateId });
    return { interview_reminder: { action: 'none' }, cv_pending: { action: 'none' } };
  }

  const settings = await readMailSettings(db);
  const context = await loadMailContext(db, candidateId);

  const reminderMissing = [];
  if (!context?.email) reminderMissing.push('candidate email');
  if (!context?.teamLeadEmail) reminderMissing.push('team lead for the candidate position');
  results.interview_reminder = await writeNotification(db, {
    candidateId,
    type: 'interview_reminder',
    subject: { interviewId },
    dueAt,
    to: unique([context?.email, context?.teamLeadEmail]),
    cc: unique(settings.hrEmails),
    missing: reminderMissing,
    userId,
  });

  if (context?.companyCvStatus === 'received') {
    await cancelOpen(db, { type: 'cv_pending', candidateId });
    results.cv_pending = { action: 'none' };
  } else {
    results.cv_pending = await writeNotification(db, {
      candidateId,
      type: 'cv_pending',
      subject: {},
      dueAt,
      to: unique([context?.email]),
      cc: unique(settings.hrEmails),
      missing: context?.email ? [] : ['candidate email'],
      userId,
    });
  }
  return results;
}

// ---------------------------------------------------------------------------
// Joining reminder
// ---------------------------------------------------------------------------

// 24 hours before joining, to the candidate, HR copied.
export async function scheduleJoiningReminder(
  db,
  { candidateId, offerId, onboardingDate, userId },
) {
  if (!onboardingDate) {
    await cancelOpen(db, { type: 'joining_reminder', candidateId, offerId });
    return { action: 'none' };
  }
  const dueAt = dayStart(onboardingDate);
  if (dueAt.getTime() <= Date.now()) {
    await cancelOpen(db, { type: 'joining_reminder', candidateId, offerId });
    return { action: 'none' };
  }

  const settings = await readMailSettings(db);
  const context = await loadMailContext(db, candidateId);
  return writeNotification(db, {
    candidateId,
    type: 'joining_reminder',
    subject: { offerId },
    dueAt,
    to: unique([context?.email]),
    cc: unique(settings.hrEmails),
    missing: context?.email ? [] : ['candidate email'],
    userId,
  });
}

// An employee who has left needs none of the reminders still waiting.
export async function cancelAllForCandidate(db, { candidateId, userId = null, reason }) {
  const { rows } = await db.query(
    `UPDATE notifications SET status = 'cancelled'
      WHERE candidate_id = $1 AND status IN ('pending', 'failed') AND sent_at IS NULL
      RETURNING id`,
    [candidateId],
  );
  for (const row of rows) {
    await recordAudit(db, {
      actorUserId: userId,
      action: 'NOTIFICATION_CANCEL',
      entityType: 'notifications',
      entityId: Number(row.id),
      details: { reason },
    });
  }
  return rows.length;
}
