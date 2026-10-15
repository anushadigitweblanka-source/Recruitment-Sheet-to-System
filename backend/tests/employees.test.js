import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { createApp } from '../src/app.js';
import {
  addMonths,
  evaluationEnd,
  monthsPhaseEnd,
  nextPhaseStart,
} from '../src/modules/employees/lifecycleDates.js';
import { createTestDatabase, createTestRole, createTestUser } from './helpers/testDb.js';

// Integration tests: a real server and real tables, in a throwaway schema.
// Every name and phone number below is made up.

let db;
let server;
let baseUrl;
let admin; // holds every permission
let viewer; // may view, cannot manage employees
let outsider; // holds no permission
let position;
let nextCode = 1;

const SLOT = '2026-11-02T10:00:00+05:30';
// The task guide's worked example: joins 2 Nov 2026.
const JOIN = '2026-11-02';

async function api(path, { method = 'GET', body, cookie } = {}) {
  const res = await fetch(`${baseUrl}/api${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

async function signedIn(options) {
  const user = await createTestUser(db.pool, options);
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: user.email, password: user.password }),
  });
  return { ...user, cookie: res.headers.get('set-cookie').split(';')[0] };
}

const as = (who) => ({ cookie: who.cookie });

// A candidate taken through Modules 1-3 to Selected, with an accepted offer.
async function acceptedCandidate(overrides = {}, onboardingDate = JOIN, offerExtra = {}) {
  const n = nextCode;
  nextCode += 1;
  const candidate = (
    await api('/candidates', {
      method: 'POST',
      ...as(admin),
      body: {
        candidateCode: `EM-${String(n).padStart(4, '0')}`,
        fullName: `Employee Sample ${n}`,
        phone: `07500${String(n).padStart(5, '0')}`,
        ...overrides,
      },
    })
  ).body.candidate;
  await api('/phone-interviews', {
    method: 'POST',
    ...as(admin),
    body: { candidateId: candidate.id, called: true, result: 'selected', interviewAt: SLOT },
  });
  await api('/interviews', {
    method: 'POST',
    ...as(admin),
    body: {
      candidateId: candidate.id,
      scheduledAt: SLOT,
      attendance: 'attended',
      scoreTechnical: 8,
      scoreAi: 7,
      scoreCommunication: 9,
      scoreConfidence: 6,
      scoreCultureFit: 10,
      decision: 'selected',
    },
  });
  const offer = await api('/offers', {
    method: 'POST',
    ...as(admin),
    body: {
      candidateId: candidate.id,
      positionId: position.id,
      offerStatus: 'accepted',
      onboardingDate,
      ...offerExtra,
    },
  });
  assert.equal(offer.status, 201, JSON.stringify(offer.body));
  return { ...candidate, offerId: offer.body.offer.id };
}

const employeeOf = async (candidateId) => {
  const { rows } = await db.pool.query('SELECT id FROM employees WHERE candidate_id = $1', [
    candidateId,
  ]);
  return rows[0] ? Number(rows[0].id) : null;
};

// A candidate whose offer is marked attended: an employee in evaluation.
async function joined(overrides, onboardingDate = JOIN) {
  const candidate = await acceptedCandidate(overrides, onboardingDate);
  const res = await api(`/offers/${candidate.offerId}`, {
    method: 'PATCH',
    ...as(admin),
    body: { attended: true },
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return { candidate, id: await employeeOf(candidate.id) };
}

const view = (id, who = admin) => api(`/employees/${id}`, as(who));
const decide = (id, body, who = admin) =>
  api(`/employees/${id}/decision`, { method: 'POST', body, ...as(who) });
const terminate = (id, body, who = admin) =>
  api(`/employees/${id}/termination`, { method: 'POST', body, ...as(who) });
const phasesOf = async (id) =>
  (await view(id)).body.phases.map(
    (p) =>
      `${p.phase}${p.isExtension ? '+' : ''} ${p.startDate}..${p.endDate ?? 'open'} ${p.result ?? '-'}`,
  );

// An employee taken to the given phase by passing each earlier one.
async function inPhase(phase, overrides) {
  const { candidate, id } = await joined(overrides);
  if (['probation', 'junior', 'senior'].includes(phase)) await decide(id, { result: 'pass' });
  if (['junior', 'senior'].includes(phase)) await decide(id, { result: 'pass' });
  if (phase === 'senior') await decide(id, { result: 'pass', endDate: '2027-11-08' });
  return { candidate, id };
}

const auditFor = async (employeeId) =>
  (
    await db.pool.query(
      `SELECT action FROM audit_log
        WHERE (entity_type = 'employees' AND entity_id = $1)
           OR (entity_type = 'phase_history'
               AND entity_id IN (SELECT id FROM phase_history WHERE employee_id = $1))
        ORDER BY id`,
      [employeeId],
    )
  ).rows.map((row) => row.action);

before(async () => {
  db = await createTestDatabase();
  server = createApp({ config: db.config, pool: db.pool }).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  await createTestRole(db.pool, 'viewer', ['candidates.view']);
  await createTestRole(db.pool, 'outsider', []);
  admin = await signedIn();
  viewer = await signedIn({ roleCode: 'viewer' });
  outsider = await signedIn({ roleCode: 'outsider' });
  position = (
    await api('/lookups/positions', {
      method: 'POST',
      ...as(admin),
      body: { name: 'Sample Position' },
    })
  ).body.item;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await db.cleanup();
});

describe('date calculations from the task guide', () => {
  test('reproduce the worked example: joins 2 Nov 2026', () => {
    const evaluation = evaluationEnd(JOIN, 7);
    const probationStart = nextPhaseStart(evaluation);
    const probation = monthsPhaseEnd(probationStart, 3);

    assert.equal(evaluation, '2026-11-08');
    assert.equal(probationStart, '2026-11-09');
    assert.equal(probation, '2027-02-08');
    assert.equal(nextPhaseStart(probation), '2027-02-09');
    // Junior "9 Feb 2027 to 8 Nov 2027" if the 9 months count after probation.
    // Not used by the application while that rule is unconfirmed.
    assert.equal(monthsPhaseEnd('2027-02-09', 9), '2027-11-08');
    assert.equal(nextPhaseStart('2027-11-08'), '2027-11-09');
  });

  test('a month later on a shorter month lands on its last day, like EDATE', () => {
    assert.equal(addMonths('2027-01-31', 1), '2027-02-28');
    assert.equal(addMonths('2028-01-31', 1), '2028-02-29');
    assert.equal(addMonths('2026-11-30', 3), '2027-02-28');
  });
});

describe('access', () => {
  test('every route refuses a visitor who is not signed in', async () => {
    assert.equal((await api('/employees')).status, 401);
    assert.equal((await api('/employees/1')).status, 401);
    assert.equal((await api('/employees/1', { method: 'PATCH', body: {} })).status, 401);
    assert.equal((await api('/employees/1/decision', { method: 'POST', body: {} })).status, 401);
    assert.equal((await api('/employees/1/termination', { method: 'POST', body: {} })).status, 401);
  });

  test('a user with no permission is refused', async () => {
    assert.equal((await api('/employees', as(outsider))).status, 403);
    assert.equal((await api('/employees/1', as(outsider))).status, 403);
  });

  test('a view-only user can read but cannot change anything', async () => {
    const { id } = await joined();

    assert.equal((await api('/employees', as(viewer))).status, 200);
    assert.equal((await view(id, viewer)).status, 200);
    assert.equal(
      (await api(`/employees/${id}`, { method: 'PATCH', body: { track: 'staff' }, ...as(viewer) }))
        .status,
      403,
    );
    assert.equal((await decide(id, { result: 'pass' }, viewer)).status, 403);
    assert.equal((await terminate(id, { reason: 'x', exitDate: JOIN }, viewer)).status, 403);
    assert.equal((await view(id)).body.employee.currentPhase, 'evaluation');
  });

  test('there is no route to create an employee directly', async () => {
    assert.equal(
      (await api('/employees', { method: 'POST', body: { candidateId: 1 }, ...as(admin) })).status,
      404,
    );
  });
});

describe('becoming an employee', () => {
  test('marking the offer attended creates the employee and the 7-day evaluation', async () => {
    const { candidate, id } = await joined();
    const res = await view(id);

    assert.equal(res.status, 200);
    assert.equal(res.body.candidate.candidateCode, candidate.candidateCode);
    assert.equal(res.body.employee.position, 'Sample Position');
    assert.equal(res.body.employee.joinDate, JOIN);
    assert.equal(res.body.employee.track, null);
    assert.equal(res.body.employee.currentPhase, 'evaluation');
    assert.equal(res.body.employee.phaseStart, '2026-11-02');
    assert.equal(res.body.employee.phaseEnd, '2026-11-08');
    assert.equal(res.body.employee.status, 'active');
    assert.equal(res.body.employee.nextReview, '2026-11-08');
    assert.deepEqual(await phasesOf(id), ['evaluation 2026-11-02..2026-11-08 -']);
    assert.deepEqual(res.body.decision.allowedResults, ['pass', 'discontinue']);
  });

  test('an offer created already attended also creates the employee', async () => {
    const candidate = await acceptedCandidate({}, '2026-11-16', { attended: true });
    const id = await employeeOf(candidate.id);

    assert.ok(id);
    assert.equal((await view(id)).body.employee.phaseEnd, '2026-11-22');
  });

  test('an accepted offer without attendance creates no employee', async () => {
    const candidate = await acceptedCandidate();

    assert.equal(await employeeOf(candidate.id), null);
  });

  test('Attended = No creates no employee', async () => {
    const candidate = await acceptedCandidate();
    await api(`/offers/${candidate.offerId}`, {
      method: 'PATCH',
      ...as(admin),
      body: { attended: false },
    });

    assert.equal(await employeeOf(candidate.id), null);
  });

  test('saving the attended offer again never creates a second employee', async () => {
    const { candidate } = await joined();
    await api(`/offers/${candidate.offerId}`, {
      method: 'PATCH',
      ...as(admin),
      body: { attended: true, location: 'Sample Office' },
    });

    const { rows } = await db.pool.query(
      'SELECT count(*)::int AS n FROM employees WHERE candidate_id = $1',
      [candidate.id],
    );
    assert.equal(rows[0].n, 1);
  });

  test('the database refuses a second employee for the same candidate', async () => {
    const { candidate } = await joined();

    await assert.rejects(
      db.pool.query(
        `INSERT INTO employees (candidate_id, join_date, phase_start) VALUES ($1, $2, $2)`,
        [candidate.id, JOIN],
      ),
      /employees_candidate_id_key/,
    );
  });

  test('once the employee exists, the offer joining details are locked', async () => {
    const { candidate, id } = await joined();

    for (const body of [
      { attended: false },
      { attended: null },
      { onboardingDate: '2026-11-09' },
      { offerStatus: 'sent', attended: null },
    ]) {
      const res = await api(`/offers/${candidate.offerId}`, {
        method: 'PATCH',
        ...as(admin),
        body,
      });
      assert.equal(res.status, 422, JSON.stringify(body));
    }
    const offer = (await api(`/offers/${candidate.offerId}`, as(admin))).body;
    assert.equal(offer.offer.attended, true);
    assert.equal(offer.candidate.stage.code, 'joined');
    assert.equal((await view(id)).body.employee.joinDate, JOIN);

    // Fields not used for the employee can still be corrected.
    const location = await api(`/offers/${candidate.offerId}`, {
      method: 'PATCH',
      ...as(admin),
      body: { location: 'Sample Office' },
    });
    assert.equal(location.status, 200);
  });

  test('creating the employee is audited with its first phase', async () => {
    const { id } = await joined();

    assert.deepEqual(await auditFor(id), ['EMPLOYEE_CREATE', 'PHASE_START']);
  });
});

describe('gate decisions', () => {
  test('evaluation pass starts probation from the next day for three months', async () => {
    const { id } = await joined();
    const res = await decide(id, {
      result: 'pass',
      reviewDocUrl: 'https://example.test/review-7th-day',
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.employee.currentPhase, 'probation');
    assert.equal(res.body.employee.phaseStart, '2026-11-09');
    assert.equal(res.body.employee.phaseEnd, '2027-02-08');
    assert.deepEqual(await phasesOf(id), [
      'evaluation 2026-11-02..2026-11-08 pass',
      'probation 2026-11-09..2027-02-08 -',
    ]);
    const evaluation = res.body.phases[0];
    assert.equal(evaluation.reviewDocUrl, 'https://example.test/review-7th-day');
    assert.equal(evaluation.reviewedBy, 'Test User');
    assert.ok(evaluation.decidedAt);
    assert.deepEqual(res.body.decision.allowedResults, ['pass', 'extend', 'discontinue']);
    assert.equal(res.body.decision.extensionLatestEnd, '2027-03-08');
  });

  test('evaluation cannot be extended', async () => {
    const { id } = await joined();
    const res = await decide(id, { result: 'extend', endDate: '2026-11-15' });

    assert.equal(res.status, 422);
    assert.match(res.body.fields.result, /pass, discontinue/);
  });

  test('probation can be extended by up to one month, as a new history row', async () => {
    const { id } = await inPhase('probation');
    const tooLong = await decide(id, { result: 'extend', endDate: '2027-03-09' });
    const extended = await decide(id, {
      result: 'extend',
      endDate: '2027-02-22',
      reason: 'More time',
    });

    assert.equal(tooLong.status, 422);
    assert.match(tooLong.body.fields.endDate, /2027-03-08 at the latest/);
    assert.equal(extended.status, 200);
    assert.equal(extended.body.employee.currentPhase, 'probation');
    assert.equal(extended.body.employee.phaseStart, '2027-02-09');
    assert.equal(extended.body.employee.phaseEnd, '2027-02-22');
    assert.deepEqual((await phasesOf(id)).slice(1), [
      'probation 2026-11-09..2027-02-08 extend',
      'probation+ 2027-02-09..2027-02-22 -',
    ]);
  });

  test('a second extension may not go beyond one month after the original end', async () => {
    const { id } = await inPhase('probation');
    await decide(id, { result: 'extend', endDate: '2027-02-22' });

    assert.equal((await decide(id, { result: 'extend', endDate: '2027-03-09' })).status, 422);
    assert.equal((await decide(id, { result: 'extend', endDate: '2027-03-08' })).status, 200);
    assert.equal((await view(id)).body.employee.phaseEnd, '2027-03-08');
  });

  test('an extension must end after the current end date', async () => {
    const { id } = await inPhase('probation');
    const res = await decide(id, { result: 'extend', endDate: '2027-02-08' });

    assert.equal(res.status, 422);
    assert.match(res.body.fields.endDate, /after the current end date/);
  });

  test('probation pass starts junior the next day, with its end date calculated from junior_months', async () => {
    const { id } = await inPhase('probation');
    await decide(id, { result: 'extend', endDate: '2027-02-22' });
    const res = await decide(id, { result: 'pass' });

    // The junior phase counts from the day after the extended probation.
    assert.equal(res.body.employee.currentPhase, 'junior');
    assert.equal(res.body.employee.phaseStart, '2027-02-23');
    assert.equal(res.body.employee.phaseEnd, '2027-11-22');
    assert.equal(res.body.employee.nextReview, '2027-11-22');
    assert.equal(res.body.decision.needsEndDate, false);
    assert.equal((await phasesOf(id)).at(-1), 'junior 2027-02-23..2027-11-22 -');
  });

  test('a junior pass uses the stored end date, and senior starts the next day', async () => {
    const { id } = await inPhase('junior');
    // A date typed in is not needed and does not override the stored one.
    const passed = await decide(id, { result: 'pass', endDate: '2027-02-01' });

    assert.equal(passed.status, 200, JSON.stringify(passed.body));
    assert.equal(passed.body.employee.currentPhase, 'senior');
    assert.equal(passed.body.employee.phaseStart, '2027-11-09');
    assert.equal(passed.body.employee.phaseEnd, null);
    assert.equal(passed.body.employee.nextReview, null);
    assert.equal(passed.body.decision, null);
    assert.deepEqual(await phasesOf(id), [
      'evaluation 2026-11-02..2026-11-08 pass',
      'probation 2026-11-09..2027-02-08 pass',
      'junior 2027-02-09..2027-11-08 pass',
      'senior 2027-11-09..open -',
    ]);
  });

  test('the senior phase has no gate decision', async () => {
    const { id } = await inPhase('senior');
    const res = await decide(id, { result: 'pass' });

    assert.equal(res.status, 422);
    assert.match(res.body.fields.result, /no gate decision/);
  });

  test('discontinue needs a reason and an exit date, and ends the employment', async () => {
    const { id } = await inPhase('probation');
    const noReason = await decide(id, { result: 'discontinue', exitDate: '2026-12-01' });
    const noDate = await decide(id, { result: 'discontinue', reason: 'Sample reason' });
    const done = await decide(id, {
      result: 'discontinue',
      reason: 'Sample reason',
      exitDate: '2026-12-01',
    });

    assert.equal(noReason.status, 422);
    assert.match(noReason.body.fields.reason, /reason is required/);
    assert.equal(noDate.status, 422);
    assert.ok(noDate.body.fields.exitDate);
    assert.equal(done.status, 200);
    assert.equal(done.body.employee.status, 'discontinued');
    assert.equal(done.body.employee.exitDate, '2026-12-01');
    assert.equal(done.body.employee.exitReason, 'Sample reason');
    // The phase they left from is kept, and no new phase is started.
    assert.equal(done.body.employee.currentPhase, 'probation');
    assert.equal(done.body.employee.nextReview, null);
    assert.equal(done.body.decision, null);
    assert.equal(done.body.canTerminate, false);
    assert.equal((await phasesOf(id)).at(-1), 'probation 2026-11-09..2027-02-08 discontinue');
  });

  test('a discontinued employee can receive no further decision', async () => {
    const { id } = await joined();
    await decide(id, { result: 'discontinue', reason: 'Sample', exitDate: '2026-11-04' });

    assert.equal((await decide(id, { result: 'pass' })).status, 422);
  });

  test('the exit date cannot be before the join date', async () => {
    const { id } = await joined();
    const res = await decide(id, {
      result: 'discontinue',
      reason: 'Sample',
      exitDate: '2026-11-01',
    });

    assert.equal(res.status, 422);
    assert.match(res.body.fields.exitDate, /before the join date/);
  });

  test('reports badly formed values field by field', async () => {
    const { id } = await joined();
    const res = await decide(id, {
      result: 'promote',
      reason: 'x'.repeat(1001),
      reviewDocUrl: 'not a link',
    });

    assert.equal(res.status, 422);
    assert.deepEqual(Object.keys(res.body.fields).sort(), ['reason', 'result', 'reviewDocUrl']);
  });

  test('earlier history rows are never changed by later decisions', async () => {
    const { id } = await joined();
    await decide(id, { result: 'pass', reviewDocUrl: 'https://example.test/first' });
    const before = (await view(id)).body.phases[0];
    await decide(id, { result: 'extend', endDate: '2027-02-20' });
    await decide(id, { result: 'pass' });

    assert.deepEqual((await view(id)).body.phases[0], before);
  });

  test('the database allows only one open phase per employee', async () => {
    const { id } = await joined();

    await assert.rejects(
      db.pool.query(
        `INSERT INTO phase_history (employee_id, phase, start_date, end_date)
         VALUES ($1, 'probation', '2026-11-09', '2027-02-08')`,
        [id],
      ),
      /phase_history_one_open_phase/,
    );
  });

  test('the database enforces the gate rules', async () => {
    const { id } = await joined();
    const insert = (columns, values) =>
      db.pool.query(
        `INSERT INTO phase_history (employee_id, phase, start_date, ${columns}, decided_at)
         VALUES ($1, ${values}, now())`,
        [id],
      );

    await assert.rejects(
      insert('end_date, result', `'evaluation', '2026-11-02', '2026-11-08', 'extend'`),
      /phase_history_extend_only_probation/,
    );
    await assert.rejects(
      insert('end_date, result', `'evaluation', '2026-11-02', '2026-11-08', 'discontinue'`),
      /phase_history_discontinue_reason/,
    );
    await assert.rejects(
      insert('result', `'senior', '2027-11-09', 'pass'`),
      /phase_history_senior_has_no_gate|phase_history_pass_needs_end_date/,
    );
    await assert.rejects(
      insert('result', `'junior', '2027-02-09', 'pass'`),
      /phase_history_pass_needs_end_date/,
    );
    await assert.rejects(
      db.pool.query(`UPDATE employees SET status = 'discontinued' WHERE id = $1`, [id]),
      /employees_exit_details/,
    );
  });
});

describe('termination', () => {
  test('is refused during evaluation and probation', async () => {
    const { id } = await inPhase('probation');
    const res = await terminate(id, { reason: 'Sample', exitDate: '2026-12-01' });

    assert.equal(res.status, 422);
    assert.match(res.body.fields.reason, /after probation has passed/);
    assert.equal((await view(id)).body.employee.status, 'active');
  });

  test('ends the employment of a junior or senior with a reason, a date and who recorded it', async () => {
    const { id } = await inPhase('junior');
    const missing = await terminate(id, {});
    const done = await terminate(id, {
      reason: 'Sample termination reason',
      exitDate: '2027-05-01',
    });

    assert.equal(missing.status, 422);
    assert.deepEqual(Object.keys(missing.body.fields).sort(), ['exitDate', 'reason']);
    assert.equal(done.status, 200);
    assert.equal(done.body.employee.status, 'terminated');
    assert.equal(done.body.employee.exitDate, '2027-05-01');
    assert.equal(done.body.employee.exitReason, 'Sample termination reason');
    assert.equal(done.body.employee.exitApprovedBy, 'Test User');
    assert.equal(done.body.canTerminate, false);
    assert.equal(done.body.decision, null);
  });
});

describe('track', () => {
  test('starts empty and can be set to Intern or Staff, and only that', async () => {
    const { id } = await joined();
    const patch = (body) => api(`/employees/${id}`, { method: 'PATCH', body, ...as(admin) });

    assert.equal((await patch({ track: 'manager' })).status, 422);
    const res = await patch({ track: 'intern', currentPhase: 'senior', joinDate: '2020-01-01' });
    assert.equal(res.status, 200);
    assert.equal(res.body.employee.track, 'intern');
    // Nothing else can be changed this way.
    assert.equal(res.body.employee.currentPhase, 'evaluation');
    assert.equal(res.body.employee.joinDate, JOIN);
  });

  test('a change is audited with the old and new value', async () => {
    const { id } = await joined();
    await api(`/employees/${id}`, { method: 'PATCH', body: { track: 'staff' }, ...as(admin) });
    const { rows } = await db.pool.query(
      `SELECT old_values, new_values FROM audit_log WHERE action = 'EMPLOYEE_UPDATE' AND entity_id = $1`,
      [id],
    );

    assert.deepEqual(rows[0].old_values, { track: null });
    assert.deepEqual(rows[0].new_values, { track: 'staff' });
  });
});

describe('listing', () => {
  let listed;

  before(async () => {
    listed = {
      evaluation: await joined({ fullName: 'Quoll Evaluation', candidateCode: 'EML-EVAL' }),
      probation: await inPhase('probation', { fullName: 'Quoll Probation' }),
      junior: await inPhase('junior', { fullName: 'Quoll Junior' }),
      senior: await inPhase('senior', { fullName: 'Quoll Senior' }),
      gone: await joined({ fullName: 'Quoll Discontinued' }, '2026-12-07'),
    };
    await decide(listed.gone.id, {
      result: 'discontinue',
      reason: 'Sample',
      exitDate: '2026-12-08',
    });
    await api(`/employees/${listed.probation.id}`, {
      method: 'PATCH',
      body: { track: 'staff' },
      ...as(admin),
    });
  });

  const list = (query = '') => api(`/employees${query}`, as(admin));
  const names = (res) => res.body.items.map((item) => item.candidate.fullName).sort();

  test('lists every employee with only the fields the list needs', async () => {
    const res = await list('?search=Quoll%20Probation');
    const item = res.body.items[0];

    assert.deepEqual(Object.keys(item).sort(), [
      'candidate',
      'currentPhase',
      'id',
      'joinDate',
      'nextReview',
      'phaseEnd',
      'phaseStart',
      'position',
      'status',
      'track',
    ]);
    assert.deepEqual(Object.keys(item.candidate).sort(), ['candidateCode', 'fullName', 'id']);
    assert.equal(item.nextReview, '2027-02-08');
  });

  test('searches by name and Candidate ID', async () => {
    assert.deepEqual(names(await list('?search=quoll%20junior')), ['Quoll Junior']);
    assert.deepEqual(names(await list('?search=eml-eval')), ['Quoll Evaluation']);
  });

  test('filters by current phase, outcome and track', async () => {
    assert.deepEqual(names(await list('?search=Quoll&phase=evaluation&status=active')), [
      'Quoll Evaluation',
    ]);
    assert.deepEqual(names(await list('?search=Quoll&phase=senior')), ['Quoll Senior']);
    assert.deepEqual(names(await list('?search=Quoll&status=exited')), ['Quoll Discontinued']);
    assert.deepEqual(names(await list('?search=Quoll&status=discontinued')), [
      'Quoll Discontinued',
    ]);
    assert.deepEqual(names(await list('?search=Quoll&track=staff')), ['Quoll Probation']);
    assert.equal((await list('?search=Quoll&track=none')).body.total, 4);
  });

  test('filters by next review date', async () => {
    assert.deepEqual(names(await list('?search=Quoll&reviewFrom=2026-11-01&reviewTo=2026-11-30')), [
      'Quoll Evaluation',
    ]);
    // The junior employee's review is now its calculated end, 8 Nov 2027.
    assert.deepEqual(names(await list('?search=Quoll&reviewFrom=2027-01-01')), [
      'Quoll Junior',
      'Quoll Probation',
    ]);
  });

  test('pages through the results and caps the page size', async () => {
    const first = await list('?search=Quoll&pageSize=2&page=1');
    const third = await list('?search=Quoll&pageSize=2&page=3');

    assert.equal(first.body.total, 5);
    assert.equal(first.body.items.length, 2);
    assert.equal(third.body.items.length, 1);
    assert.equal((await list('?pageSize=9999')).body.pageSize, 100);
  });

  test('ignores an unknown filter value', async () => {
    assert.equal(
      (await list(`?search=Quoll&phase=${encodeURIComponent("x' OR 1=1")}`)).body.total,
      5,
    );
  });

  test('answers "not found" for an unknown or malformed id', async () => {
    assert.equal((await view(999999)).status, 404);
    assert.equal((await view('abc')).status, 404);
    assert.equal((await decide(999999, { result: 'pass' })).status, 404);
  });
});

describe('audit log', () => {
  test('each decision is audited, and every new phase is recorded as started', async () => {
    const { id } = await joined();
    await decide(id, { result: 'pass' });
    await decide(id, { result: 'extend', endDate: '2027-02-20' });
    await decide(id, { result: 'pass' });
    await decide(id, { result: 'discontinue', reason: 'Sample', exitDate: '2027-03-01' });

    assert.deepEqual(await auditFor(id), [
      'EMPLOYEE_CREATE',
      'PHASE_START',
      'PHASE_COMPLETE',
      'PHASE_START',
      'PHASE_EXTEND',
      'PHASE_START',
      'PHASE_COMPLETE',
      'PHASE_START',
      'EMPLOYEE_DISCONTINUE',
    ]);
  });

  test('a refused decision writes nothing', async () => {
    const { id } = await joined();
    const before = await auditFor(id);
    await decide(id, { result: 'extend', endDate: '2026-12-01' });

    assert.deepEqual(await auditFor(id), before);
    assert.deepEqual(await phasesOf(id), ['evaluation 2026-11-02..2026-11-08 -']);
  });

  test('a termination records who ended the employment and why', async () => {
    const { id } = await inPhase('senior');
    await terminate(id, { reason: 'Sample termination reason', exitDate: '2028-01-10' });
    const { rows } = await db.pool.query(
      `SELECT actor_user_id, new_values FROM audit_log WHERE action = 'EMPLOYEE_TERMINATE' AND entity_id = $1`,
      [id],
    );

    assert.equal(rows[0].actor_user_id, String(admin.id));
    assert.deepEqual(rows[0].new_values, {
      status: 'terminated',
      exitDate: '2028-01-10',
      reason: 'Sample termination reason',
      phase: 'senior',
    });
  });
});

describe('scope', () => {
  test('the employees table holds no salary or company account secret', async () => {
    const { rows } = await db.pool.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = $1 AND table_name = 'employees'
          AND column_name ~* 'salary|password|secret'`,
      [db.schema],
    );
    assert.deepEqual(rows, []);
  });

  test('the phase durations are editable settings with the values from the guide', async () => {
    const { rows } = await db.pool.query('SELECT key, value FROM settings ORDER BY key');

    const settings = Object.fromEntries(rows.map((row) => [row.key, row.value]));
    assert.deepEqual(
      {
        evaluation_days: settings.evaluation_days,
        junior_months: settings.junior_months,
        probation_max_extension_months: settings.probation_max_extension_months,
        probation_months: settings.probation_months,
      },
      {
        evaluation_days: '7',
        junior_months: '9',
        probation_max_extension_months: '1',
        probation_months: '3',
      },
    );
  });

  test('a changed setting is used for the next calculation', async () => {
    await db.pool.query(`UPDATE settings SET value = '5' WHERE key = 'evaluation_days'`);
    try {
      const { id } = await joined();
      assert.equal((await view(id)).body.employee.phaseEnd, '2026-11-06');
    } finally {
      await db.pool.query(`UPDATE settings SET value = '7' WHERE key = 'evaluation_days'`);
    }
  });
});

describe('junior end date', () => {
  const setSetting = (key, value) =>
    api(`/admin/settings/${key}`, { method: 'PATCH', ...as(admin), body: { value } });
  const phaseRows = async (id) =>
    (
      await db.pool.query(
        `SELECT id, phase, to_char(start_date, 'YYYY-MM-DD') AS start_date,
                to_char(end_date, 'YYYY-MM-DD') AS end_date
           FROM phase_history WHERE employee_id = $1 ORDER BY id`,
        [id],
      )
    ).rows;
  const notesFor = async (phaseHistoryId) =>
    (
      await db.pool.query('SELECT * FROM notifications WHERE phase_history_id = $1 ORDER BY id', [
        phaseHistoryId,
      ])
    ).rows;

  test('reproduces the guide: join 2 Nov 2026, junior 9 Feb to 8 Nov 2027, senior from 9 Nov 2027', async () => {
    const { id } = await joined({ fullName: 'Junior Guide Example' }, '2026-11-02');
    await decide(id, { result: 'pass' });
    await decide(id, { result: 'pass' });
    const passed = await decide(id, { result: 'pass' });

    assert.equal(passed.status, 200, JSON.stringify(passed.body));
    assert.deepEqual(await phasesOf(id), [
      'evaluation 2026-11-02..2026-11-08 pass',
      'probation 2026-11-09..2027-02-08 pass',
      'junior 2027-02-09..2027-11-08 pass',
      'senior 2027-11-09..open -',
    ]);
  });

  test('a join on the 31st counts months to the end of shorter months', async () => {
    const { id } = await joined({ fullName: 'Junior Month End' }, '2026-08-31');
    await decide(id, { result: 'pass' });
    const res = await decide(id, { result: 'pass' });

    // Probation 7 Sep to 6 Dec 2026, junior from 7 Dec 2026 for 9 months.
    assert.equal(res.body.employee.phaseStart, '2026-12-07');
    assert.equal(res.body.employee.phaseEnd, '2027-09-06');
  });

  test('the duration is the junior_months setting, and old phases are not recalculated', async () => {
    const before = await inPhase('junior', { fullName: 'Junior Before Change' });
    const beforeRows = await phaseRows(before.id);
    assert.equal((await setSetting('junior_months', '6')).status, 200);
    try {
      const after = await joined({ fullName: 'Junior After Change' }, '2026-11-02');
      await decide(after.id, { result: 'pass' });
      const res = await decide(after.id, { result: 'pass' });
      assert.equal(res.body.employee.phaseEnd, '2027-08-08'); // 9 Feb + 6 months - 1 day

      // The earlier employee's junior phase is exactly as it was.
      assert.deepEqual(await phaseRows(before.id), beforeRows);
      assert.equal((await view(before.id)).body.employee.phaseEnd, '2027-11-08');
    } finally {
      assert.equal((await setSetting('junior_months', '9')).status, 200);
    }
  });

  test('records the calculated end in the phase history and the audit log', async () => {
    const { id } = await inPhase('junior', { fullName: 'Junior Audited' });
    const { rows } = await db.pool.query(
      `SELECT a.new_values FROM audit_log a
         JOIN phase_history p ON p.id = a.entity_id
        WHERE a.action = 'PHASE_START' AND a.entity_type = 'phase_history'
          AND p.employee_id = $1 AND p.phase = 'junior'`,
      [id],
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].new_values.endDate, '2027-11-08');
    assert.equal(rows[0].new_values.phase, 'junior');
  });

  test('creates one junior deadline reminder: 17:30 Colombo, sent 24 hours before', async () => {
    assert.equal((await setSetting('reminder_hr_emails', 'hr.junior@example.test')).status, 200);
    try {
      const { id } = await inPhase('junior', { fullName: 'Junior Reminder' });
      const junior = (await phaseRows(id)).find((p) => p.phase === 'junior');
      const notes = await notesFor(junior.id);

      assert.equal(notes.length, 1, 'exactly one reminder for the junior phase');
      const [note] = notes;
      assert.equal(note.type, 'junior_end');
      assert.equal(note.status, 'pending');
      assert.equal(note.due_at.toISOString(), '2027-11-08T12:00:00.000Z'); // 17:30 +05:30
      assert.equal(note.send_at.getTime(), note.due_at.getTime() - 24 * 3600 * 1000);
      assert.deepEqual(note.recipients, ['hr.junior@example.test']);

      // A second pending reminder for the same phase cannot exist.
      await assert.rejects(
        db.pool.query(
          `INSERT INTO notifications (candidate_id, type, phase_history_id, due_at, send_at, recipients)
           VALUES ($1, 'junior_end', $2, $3, $4, ARRAY['hr.junior@example.test'])`,
          [note.candidate_id, junior.id, note.due_at, note.send_at],
        ),
        /notifications_one_per_phase|duplicate key/,
      );
      assert.equal((await notesFor(junior.id)).length, 1);

      // Deciding the phase cancels its reminder and starts none for senior.
      await decide(id, { result: 'pass' });
      const after = await notesFor(junior.id);
      assert.deepEqual(
        after.map((n) => n.status),
        ['cancelled'],
      );
      const senior = (await phaseRows(id)).find((p) => p.phase === 'senior');
      assert.deepEqual(await notesFor(senior.id), []);
    } finally {
      await setSetting('reminder_hr_emails', '');
    }
  });

  test('a probation extension moves the junior start, end and reminder', async () => {
    assert.equal((await setSetting('reminder_hr_emails', 'hr.junior@example.test')).status, 200);
    try {
      const { id } = await inPhase('probation', { fullName: 'Junior Extended' });
      await decide(id, { result: 'extend', endDate: '2027-02-22' });
      await decide(id, { result: 'pass' });

      const junior = (await phaseRows(id)).find((p) => p.phase === 'junior');
      assert.equal(junior.start_date, '2027-02-23');
      assert.equal(junior.end_date, '2027-11-22');
      const [note] = await notesFor(junior.id);
      assert.equal(note.due_at.toISOString(), '2027-11-22T12:00:00.000Z');
    } finally {
      await setSetting('reminder_hr_emails', '');
    }
  });

  test('a junior phase stored without an end date still needs it entered, and is never filled in by itself', async () => {
    const { id } = await inPhase('junior', { fullName: 'Junior Legacy' });
    // As an employee would look if the junior phase pre-dates the calculation.
    await db.pool.query(
      `UPDATE phase_history SET end_date = NULL WHERE employee_id = $1 AND phase = 'junior'`,
      [id],
    );
    await db.pool.query('UPDATE employees SET phase_end = NULL WHERE id = $1', [id]);

    const shown = await view(id);
    assert.equal(shown.body.employee.phaseEnd, null, 'reading it does not backfill');
    assert.equal(shown.body.decision.needsEndDate, true);

    const missing = await decide(id, { result: 'pass' });
    assert.equal(missing.status, 422);
    assert.match(missing.body.fields.endDate, /required/);
    const tooEarly = await decide(id, { result: 'pass', endDate: '2027-02-01' });
    assert.equal(tooEarly.status, 422);
    const passed = await decide(id, { result: 'pass', endDate: '2027-11-08' });
    assert.equal(passed.status, 200);
    assert.equal(passed.body.employee.phaseStart, '2027-11-09');
  });
});
