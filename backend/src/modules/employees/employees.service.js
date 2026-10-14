import { inTransaction } from '../../db/transaction.js';
import { recordAudit } from '../audit/audit.js';
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
import { evaluationEnd, monthsPhaseEnd, nextPhaseStart } from './lifecycleDates.js';

// Every function here returns one of:
//   { ok: true, data }                               data = employee details
//   { ok: false, reason: 'validation', fields }
//   { ok: false, reason: 'not_found' }

const invalid = (fields) => ({ ok: false, reason: 'validation', fields });

// The phase that follows a pass. Senior has no gate, so nothing follows it.
const NEXT_PHASE = { evaluation: 'probation', probation: 'junior', junior: 'senior' };

async function startPhase(db, { employeeId, phase, startDate, endDate, isExtension }, user) {
  const id = await insertPhase(db, { employeeId, phase, startDate, endDate, isExtension }, user.id);
  await setCurrentPhase(db, employeeId, { phase, startDate, endDate }, user.id);
  await recordAudit(db, {
    actorUserId: user.id,
    action: 'PHASE_START',
    entityType: 'phase_history',
    entityId: id,
    newValues: { employeeId, phase, startDate, endDate, isExtension: Boolean(isExtension) },
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
  await startPhase(db, { employeeId: id, phase: 'evaluation', startDate: joinDate, endDate }, user);
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
      // A junior pass needs its end date entered; it is not calculated.
      needsEndDate: open.phase === 'junior' && !open.endDate,
      extensionLatestEnd:
        open.phase === 'probation' ? await extensionLatestEnd(pool, employee.id, settings) : null,
    };
  }
  return {
    ...data,
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
    await startPhase(
      db,
      {
        employeeId: id,
        phase: next,
        startDate,
        // Probation has a calculated end. Junior's end is not confirmed, and
        // senior has none.
        endDate: next === 'probation' ? monthsPhaseEnd(startDate, settings.probationMonths) : null,
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
    return { ok: true };
  });

  if (!outcome.ok) return outcome;
  return { ok: true, data: await getEmployee(pool, id) };
}
