import { inTransaction } from '../../db/transaction.js';
import { recordAudit } from '../audit/audit.js';
import {
  findAccountForCandidate,
  requestAccountDisable,
  requestCompanyAccount,
} from '../company-accounts/companyAccounts.service.js';
import {
  cancelAllForCandidate,
  cancelPhaseReminders,
  schedulePhaseReminder,
} from '../notifications/scheduling.js';
import {
  closePhase,
  employeeIdForCandidate,
  findEmployee,
  insertEmployee,
  insertPhase,
  lockEmployee,
  lockOpenPhase,
  originalProbationEnd,
  readLifecycleSettings,
  setCurrentPhase,
  setExit,
  setPhaseEnd,
  setTrack,
} from './employees.repository.js';
import {
  PHASES_THAT_CAN_TERMINATE,
  RESULTS_BY_PHASE,
  validateDecision,
  validateTermination,
  validateTrack,
} from './employees.validation.js';
import { evaluationEnd, juniorPhaseEnd, monthsPhaseEnd, nextPhaseStart } from './lifecycleDates.js';

// Every function here returns one of:
//   { ok: true, data }                               data = employee details
//   { ok: false, reason: 'validation', fields }
//   { ok: false, reason: 'not_found' }

const invalid = (fields) => ({ ok: false, reason: 'validation', fields });

// The phase that follows a pass. Senior has no gate, so nothing follows it.
const NEXT_PHASE = { evaluation: 'probation', probation: 'junior', junior: 'senior' };

async function startPhase(
  db,
  { employeeId, candidateId, phase, startDate, endDate, isExtension },
  user,
) {
  const id = await insertPhase(db, { employeeId, phase, startDate, endDate, isExtension }, user.id);
  await setCurrentPhase(db, employeeId, { phase, startDate, endDate }, user.id);
  await recordAudit(db, {
    actorUserId: user.id,
    action: 'PHASE_START',
    entityType: 'phase_history',
    entityId: id,
    newValues: { employeeId, phase, startDate, endDate, isExtension: Boolean(isExtension) },
  });
  // The guide: create the notification when the phase row is created.
  await schedulePhaseReminder(db, {
    candidateId,
    phaseHistoryId: id,
    phase,
    endDate,
    userId: user.id,
  });
  return id;
}

// "Attended = Yes creates the employee and the 7-day evaluation." Called by
// the offer module inside its own transaction, so the offer, the stage change
// and the new employee are saved together or not at all. A candidate who
// already has an employee record is never given a second one.
export async function createEmployeeOnJoin(db, { candidateId, joinDate, user }) {
  const existing = await employeeIdForCandidate(db, candidateId);
  if (existing) return existing;

  const settings = await readLifecycleSettings(db);
  const endDate = evaluationEnd(joinDate, settings.evaluationDays);
  const id = await insertEmployee(db, { candidateId, joinDate, phaseEnd: endDate }, user.id);
  await recordAudit(db, {
    actorUserId: user.id,
    action: 'EMPLOYEE_CREATE',
    entityType: 'employees',
    entityId: id,
    newValues: { candidateId, joinDate, currentPhase: 'evaluation' },
    details: { source: 'offer_attended' },
  });
  await startPhase(
    db,
    { employeeId: id, candidateId, phase: 'evaluation', startDate: joinDate, endDate },
    user,
  );
  // The guide: Attended = Yes leads to Account Requested.
  await requestCompanyAccount(db, { candidateId, employeeId: id, userId: user.id });
  return id;
}

export { employeeIdForCandidate };

// The latest end date a probation extension may have: the maximum extension
// counted from the day after the original probation end.
async function extensionLatestEnd(db, employeeId, settings) {
  const originalEnd = await originalProbationEnd(db, employeeId);
  return originalEnd
    ? monthsPhaseEnd(nextPhaseStart(originalEnd), settings.probationMaxExtensionMonths)
    : null;
}

// An employee who leaves needs none of the reminders still waiting, and the
// company account gets its Disable action.
async function leaveHooks(db, { candidateId, user, reason }) {
  await cancelAllForCandidate(db, { candidateId, userId: user.id, reason });
  await requestAccountDisable(db, { candidateId, userId: user.id });
}

// The employee, with what can be decided next, for the details page.
export async function getEmployee(pool, id) {
  const data = await findEmployee(pool, id);
  if (!data) return null;

  const { employee, phases } = data;
  const open = phases.find((phase) => phase.result === null) ?? null;
  const active = employee.status === 'active';
  let decision = null;
  if (active && open && RESULTS_BY_PHASE[open.phase].length > 0) {
    const settings = await readLifecycleSettings(pool);
    decision = {
      phaseId: open.id,
      phase: open.phase,
      allowedResults: RESULTS_BY_PHASE[open.phase],
      // A junior phase created before the end date was calculated has none, and
      // its pass still needs the date entered; newer ones carry their own.
      needsEndDate: open.phase === 'junior' && !open.endDate,
      extensionLatestEnd:
        open.phase === 'probation' ? await extensionLatestEnd(pool, employee.id, settings) : null,
    };
  }
  // The profile shows where the company account stands (never a password).
  const account = await findAccountForCandidate(pool, data.candidate.id);
  return {
    ...data,
    companyAccount: account
      ? {
          id: account.id,
          status: account.status,
          companyEmail: account.companyEmail,
          createdDate: account.createdDate,
          handedOverDate: account.handedOverDate,
          disablePending: account.disablePending,
          disabledDate: account.disabledDate,
        }
      : null,
    decision,
    canTerminate: active && PHASES_THAT_CAN_TERMINATE.includes(employee.currentPhase),
  };
}

export async function updateEmployee(pool, user, id, input) {
  const { track, errors } = validateTrack(input);
  if (Object.keys(errors).length > 0) return invalid(errors);

  const outcome = await inTransaction(pool, async (db) => {
    const employee = await lockEmployee(db, id);
    if (!employee) return { ok: false, reason: 'not_found' };
    if (employee.track !== track) {
      await setTrack(db, id, track, user.id);
      await recordAudit(db, {
        actorUserId: user.id,
        action: 'EMPLOYEE_UPDATE',
        entityType: 'employees',
        entityId: id,
        oldValues: { track: employee.track },
        newValues: { track },
      });
    }
    return { ok: true };
  });
  if (!outcome.ok) return outcome;
  return { ok: true, data: await getEmployee(pool, id) };
}

// Records the gate decision on the open phase, and starts the next phase.
// The earlier rows are never changed; the decided row only gains its result.
export async function recordDecision(pool, user, id, input) {
  const outcome = await inTransaction(pool, async (db) => {
    const employee = await lockEmployee(db, id);
    if (!employee) return { ok: false, reason: 'not_found' };
    if (employee.status !== 'active') {
      return invalid({
        result: 'This employee is no longer active, so no decision can be recorded.',
      });
    }
    const phase = await lockOpenPhase(db, id);
    if (!phase) return invalid({ result: 'This employee has no open phase to decide on.' });

    const settings = await readLifecycleSettings(db);
    const extensionLatest =
      phase.phase === 'probation' ? await extensionLatestEnd(db, id, settings) : null;
    const { values, errors } = validateDecision(input, {
      phase,
      joinDate: employee.joinDate,
      extensionLatest,
    });
    if (Object.keys(errors).length > 0) return invalid(errors);

    const endDate = values.result === 'pass' && phase.phase === 'junior' ? values.endDate : null;
    await closePhase(
      db,
      phase.id,
      {
        result: values.result,
        reason: values.reason,
        reviewDocUrl: values.reviewDocUrl,
        endDate,
      },
      user.id,
    );
    if (endDate) await setPhaseEnd(db, id, endDate, user.id);
    // The decided phase needs no reminder any more.
    await cancelPhaseReminders(db, { phaseHistoryId: phase.id, userId: user.id });

    const decided = {
      employeeId: id,
      phase: phase.phase,
      result: values.result,
      ...(values.reason ? { reason: values.reason } : {}),
      ...(endDate ? { endDate } : {}),
    };

    if (values.result === 'discontinue') {
      await setExit(
        db,
        id,
        {
          status: 'discontinued',
          exitDate: values.exitDate,
          exitReason: values.reason,
          approvedBy: null,
        },
        user.id,
      );
      await recordAudit(db, {
        actorUserId: user.id,
        action: 'EMPLOYEE_DISCONTINUE',
        entityType: 'employees',
        entityId: id,
        oldValues: { status: 'active' },
        newValues: { status: 'discontinued', exitDate: values.exitDate, ...decided },
      });
      await leaveHooks(db, { candidateId: employee.candidateId, user, reason: 'discontinued' });
      return { ok: true };
    }

    if (values.result === 'extend') {
      await recordAudit(db, {
        actorUserId: user.id,
        action: 'PHASE_EXTEND',
        entityType: 'phase_history',
        entityId: phase.id,
        newValues: decided,
      });
      // "Extension adds a new row in phase_history."
      await startPhase(
        db,
        {
          employeeId: id,
          candidateId: employee.candidateId,
          phase: 'probation',
          startDate: nextPhaseStart(phase.endDate),
          endDate: values.endDate,
          isExtension: true,
        },
        user,
      );
      return { ok: true };
    }

    // Pass: "the system must create the next phase row automatically, copy
    // the dates, and update current_phase in employees".
    await recordAudit(db, {
      actorUserId: user.id,
      action: 'PHASE_COMPLETE',
      entityType: 'phase_history',
      entityId: phase.id,
      newValues: decided,
    });
    const next = NEXT_PHASE[phase.phase];
    const startDate = nextPhaseStart(endDate ?? phase.endDate);
    // Junior starts the day after probation (or its extension) finishes and
    // lasts junior_months: EDATE(start, junior_months) - 1 day. This is the
    // project owner's implementation decision (the guide's worked example),
    // not an HR sign-off; the duration stays the editable junior_months setting.
    const juniorEnd =
      next === 'junior'
        ? juniorPhaseEnd({
            juniorStart: startDate,
            joinDate: employee.joinDate,
            months: settings.juniorMonths,
            basis: 'after_probation',
          })
        : null;
    await startPhase(
      db,
      {
        employeeId: id,
        candidateId: employee.candidateId,
        phase: next,
        startDate,
        // Probation and junior have a calculated end; senior has none.
        endDate:
          next === 'probation' ? monthsPhaseEnd(startDate, settings.probationMonths) : juniorEnd,
      },
      user,
    );
    return { ok: true };
  });

  if (!outcome.ok) return outcome;
  return { ok: true, data: await getEmployee(pool, id) };
}

// "Terminated = employment ended by the company after confirmation."
export async function terminateEmployee(pool, user, id, input) {
  const outcome = await inTransaction(pool, async (db) => {
    const employee = await lockEmployee(db, id);
    if (!employee) return { ok: false, reason: 'not_found' };
    if (employee.status !== 'active') {
      return invalid({ reason: 'This employee is no longer active.' });
    }
    if (!PHASES_THAT_CAN_TERMINATE.includes(employee.currentPhase)) {
      return invalid({
        reason:
          'Termination applies after probation has passed. During evaluation or probation, record a Discontinue decision instead.',
      });
    }
    const { values, errors } = validateTermination(input, { joinDate: employee.joinDate });
    if (Object.keys(errors).length > 0) return invalid(errors);

    await setExit(
      db,
      id,
      {
        status: 'terminated',
        exitDate: values.exitDate,
        exitReason: values.reason,
        approvedBy: user.id,
      },
      user.id,
    );
    await recordAudit(db, {
      actorUserId: user.id,
      action: 'EMPLOYEE_TERMINATE',
      entityType: 'employees',
      entityId: id,
      oldValues: { status: 'active' },
      newValues: {
        status: 'terminated',
        exitDate: values.exitDate,
        reason: values.reason,
        phase: employee.currentPhase,
      },
    });
    await leaveHooks(db, { candidateId: employee.candidateId, user, reason: 'terminated' });
    return { ok: true };
  });

  if (!outcome.ok) return outcome;
  return { ok: true, data: await getEmployee(pool, id) };
}
