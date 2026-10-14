import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { createApp } from '../src/app.js';
import { createTestDatabase, createTestRole, createTestUser } from './helpers/testDb.js';

// Integration tests: a real server and real tables, in a throwaway schema.
// Every name, address and phone number below is made up.

let db;
let server;
let baseUrl;
let admin;
let outsider;
let positionId;

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

// Inserts a candidate directly with a chosen current stage, the shape the
// pipeline module maintains in the application.
async function candidateAtStage(code, stage) {
  const { rows } = await db.pool.query(
    `INSERT INTO candidates (candidate_code, full_name, phone, position_id)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [
      code,
      `Dash Sample ${code}`,
      `07600${code.slice(-5).replace(/\D/g, '').padStart(5, '0')}`,
      positionId,
    ],
  );
  const id = Number(rows[0].id);
  // Rejected and on-hold stages require their reason (schema constraints).
  await db.pool.query(
    `INSERT INTO pipeline_status (candidate_id, current_stage, reject_reason, hold_reason)
     VALUES ($1, $2, $3, $4)`,
    [
      id,
      stage,
      stage === 'rejected' ? 'fictional test rejection' : null,
      stage === 'on_hold' ? 'fictional test hold' : null,
    ],
  );
  return id;
}

async function employeeFor(candidateId, { phase, status = 'active', phaseEnd }) {
  // A non-active employee must carry exit details (schema constraint).
  const exited = status !== 'active';
  const { rows } = await db.pool.query(
    `INSERT INTO employees (candidate_id, join_date, current_phase, phase_start, phase_end, status,
                            exit_date, exit_reason)
     VALUES ($1, current_date - 30, $2, current_date - 30, $3, $4, $5, $6) RETURNING id`,
    [
      candidateId,
      phase,
      phaseEnd ?? null,
      status,
      exited ? new Date() : null,
      exited ? 'fictional test exit' : null,
    ],
  );
  return Number(rows[0].id);
}

const summary = (who = admin) => api('/dashboard/summary', { cookie: who.cookie });

before(async () => {
  db = await createTestDatabase();
  server = createApp({ config: db.config, pool: db.pool }).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  await createTestRole(db.pool, 'outsider', []);
  admin = await signedIn();
  outsider = await signedIn({ roleCode: 'outsider' });

  const pos = await db.pool.query(
    `INSERT INTO positions (name) VALUES ('Dash Sample Position') RETURNING id`,
  );
  positionId = Number(pos.rows[0].id);
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await db.cleanup();
});

describe('access', () => {
  test('refuses a visitor who is not signed in', async () => {
    assert.equal((await api('/dashboard/summary')).status, 401);
  });

  test('refuses a signed-in user without candidates.view', async () => {
    assert.equal((await summary(outsider)).status, 403);
  });
});

describe('summary figures', () => {
  test('empty database gives all-zero counts, not errors', async () => {
    const res = await summary();
    assert.equal(res.status, 200);
    assert.equal(res.body.counts.totalCandidates, 0);
    assert.equal(res.body.counts.joined, 0);
    assert.deepEqual(res.body.employeePhases, {
      evaluation: 0,
      probation: 0,
      junior: 0,
      senior: 0,
    });
    assert.deepEqual(res.body.upcomingInterviews, []);
    assert.deepEqual(res.body.upcomingDeadlines, []);
  });

  test('counts candidates once each, by their current stage', async () => {
    const applied = await candidateAtStage('DASH-0001', 'applied');
    await candidateAtStage('DASH-0002', 'phone_screened');
    await candidateAtStage('DASH-0003', 'interview_scheduled');
    await candidateAtStage('DASH-0004', 'selected');
    await candidateAtStage('DASH-0005', 'rejected');
    await candidateAtStage('DASH-0006', 'joined');

    // A long stage history must not inflate any count: the candidate is
    // counted in the stage they are in now, once.
    await db.pool.query(
      `INSERT INTO stage_history (candidate_id, from_stage, to_stage)
       VALUES ($1, NULL, 'applied'), ($1, 'applied', 'phone_screened'), ($1, 'phone_screened', 'applied')`,
      [applied],
    );

    const res = await summary();
    assert.equal(res.body.counts.totalCandidates, 6);
    assert.equal(res.body.counts.applied, 1);
    assert.equal(res.body.counts.phoneScreened, 1);
    assert.equal(res.body.counts.interviewsScheduled, 1);
    assert.equal(res.body.counts.selected, 1);
    assert.equal(res.body.counts.rejected, 1);
    assert.equal(res.body.counts.joined, 1);
    assert.equal(res.body.counts.interviewed, 0);
  });

  test('employee phase counts cover only active employees, not history', async () => {
    const c1 = await candidateAtStage('DASH-0101', 'joined');
    const c2 = await candidateAtStage('DASH-0102', 'joined');
    const c3 = await candidateAtStage('DASH-0103', 'joined');
    const e1 = await employeeFor(c1, { phase: 'probation', phaseEnd: '2099-01-01' });
    await employeeFor(c2, { phase: 'junior' }); // junior end unknown: NULL
    await employeeFor(c3, { phase: 'evaluation', status: 'discontinued', phaseEnd: '2099-01-01' });

    // Past phase rows exist in history; they must not count as current.
    await db.pool.query(
      `INSERT INTO phase_history (employee_id, phase, start_date, end_date, result,
                                  reviewed_by, decided_at)
       VALUES ($1, 'evaluation', current_date - 30, current_date - 24, 'pass', $2, now())`,
      [e1, admin.id],
    );

    const res = await summary();
    assert.equal(res.body.employeePhases.probation, 1);
    assert.equal(res.body.employeePhases.junior, 1);
    assert.equal(res.body.employeePhases.evaluation, 0, 'discontinued employee is not current');
    assert.equal(res.body.counts.currentlyWorking, 2);
    assert.equal(res.body.counts.discontinued, 1);
    assert.equal(res.body.counts.terminated, 0);
  });
});

describe('upcoming interviews', () => {
  test('lists future interviews nearest first, past ones excluded, limit 10', async () => {
    const ids = [];
    for (let n = 0; n < 12; n += 1) {
      const c = await candidateAtStage(
        `DASH-02${String(n).padStart(2, '0')}`,
        'interview_scheduled',
      );
      ids.push(c);
      await db.pool.query(
        `INSERT INTO interviews (candidate_id, scheduled_at)
         VALUES ($1, now() + ($2 || ' hours')::interval)`,
        [c, 24 + n],
      );
    }
    const past = await candidateAtStage('DASH-0299', 'interviewed');
    await db.pool.query(
      `INSERT INTO interviews (candidate_id, scheduled_at) VALUES ($1, now() - interval '1 day')`,
      [past],
    );

    const res = await summary();
    const list = res.body.upcomingInterviews;
    assert.equal(list.length, 10, 'limited to 10');
    assert.equal(list[0].candidateCode, 'DASH-0200', 'nearest first');
    assert.ok(!list.some((row) => row.candidateCode === 'DASH-0299'), 'past interview excluded');
    assert.deepEqual(
      Object.keys(list[0]).sort(),
      ['candidateCode', 'candidateName', 'id', 'interviewer', 'position', 'scheduledAt', 'stage'],
      'only safe fields are exposed',
    );
  });
});

describe('upcoming deadlines', () => {
  test('includes 7-day window only, excludes null junior end dates and senior', async () => {
    const inWindow = await candidateAtStage('DASH-0301', 'joined');
    const outWindow = await candidateAtStage('DASH-0302', 'joined');
    const nullJunior = await candidateAtStage('DASH-0303', 'joined');
    const senior = await candidateAtStage('DASH-0304', 'joined');

    await db.pool.query(
      `INSERT INTO employees (candidate_id, join_date, current_phase, phase_start, phase_end, status) VALUES
       ($1, current_date - 5, 'evaluation', current_date - 5, current_date + 2, 'active'),
       ($2, current_date - 5, 'probation',  current_date - 5, current_date + 30, 'active'),
       ($3, current_date - 90, 'junior',    current_date - 10, NULL, 'active'),
       ($4, current_date - 400, 'senior',   current_date - 10, NULL, 'active')`,
      [inWindow, outWindow, nullJunior, senior],
    );

    const res = await summary();
    const codes = res.body.upcomingDeadlines.map((row) => row.candidateCode);
    assert.ok(codes.includes('DASH-0301'), 'deadline within 7 days included');
    assert.ok(!codes.includes('DASH-0302'), 'deadline outside 7 days excluded');
    assert.ok(!codes.includes('DASH-0303'), 'junior with no end date excluded, not invented');
    assert.ok(!codes.includes('DASH-0304'), 'senior never appears');

    const row = res.body.upcomingDeadlines.find((r) => r.candidateCode === 'DASH-0301');
    assert.equal(row.daysRemaining, 2);
    assert.equal(row.phase, 'evaluation');
  });
});

describe('nothing sensitive leaks', () => {
  test('the whole answer never contains salary, hashes or credentials', async () => {
    const res = await summary();
    const text = JSON.stringify(res.body).toLowerCase();
    for (const word of ['salary', 'password', 'hash', 'token', 'credential']) {
      assert.ok(!text.includes(word), `answer must not contain "${word}"`);
    }
  });
});
