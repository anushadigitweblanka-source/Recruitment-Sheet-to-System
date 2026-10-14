import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { createApp } from '../src/app.js';
import {
  isMonday,
  parseWeeklyQuery,
  previousWeekStart,
} from '../src/modules/reports/reports.validation.js';
import { createTestDatabase, createTestRole, createTestUser } from './helpers/testDb.js';

// Integration tests: a real server and real tables, in a throwaway schema.
// Every name, address and phone number below is made up.

let db;
let server;
let baseUrl;
let admin;
let outsider;
let positionA;
let positionB;
let sourceA;

async function api(path, { cookie } = {}) {
  const res = await fetch(`${baseUrl}/api${path}`, {
    headers: cookie ? { Cookie: cookie } : {},
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

// A candidate at a stage, with a chosen created_at (a Colombo calendar day).
async function candidateAt(code, stage, { createdAt, positionId, sourceId } = {}) {
  const { rows } = await db.pool.query(
    `INSERT INTO candidates (candidate_code, full_name, phone, position_id, source_id, created_at)
     VALUES ($1, $2, $3, $4, $5, coalesce($6::timestamptz, now())) RETURNING id`,
    [
      code,
      `Report Sample ${code}`,
      `07700${code.slice(-5).replace(/\D/g, '').padStart(5, '0')}`,
      positionId ?? positionA,
      sourceId ?? null,
      createdAt ?? null,
    ],
  );
  const id = Number(rows[0].id);
  await db.pool.query(
    `INSERT INTO pipeline_status (candidate_id, current_stage, reject_reason, hold_reason)
     VALUES ($1, $2, $3, $4)`,
    [
      id,
      stage,
      stage === 'rejected' ? 'fictional rejection' : null,
      stage === 'on_hold' ? 'fictional hold' : null,
    ],
  );
  return id;
}

const moveStage = (candidateId, toStage, changedAt) =>
  db.pool.query(
    `INSERT INTO stage_history (candidate_id, from_stage, to_stage, changed_at)
     VALUES ($1, 'applied', $2, $3::timestamptz)`,
    [candidateId, toStage, changedAt],
  );

before(async () => {
  db = await createTestDatabase();
  server = createApp({ config: db.config, pool: db.pool }).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  await createTestRole(db.pool, 'outsider', []);
  admin = await signedIn();
  outsider = await signedIn({ roleCode: 'outsider' });

  const lookups = await db.pool.query(
    `INSERT INTO positions (name) VALUES ('Report Position A'), ('Report Position B') RETURNING id`,
  );
  positionA = Number(lookups.rows[0].id);
  positionB = Number(lookups.rows[1].id);
  const src = await db.pool.query(
    `INSERT INTO sources (name) VALUES ('Report Source A') RETURNING id`,
  );
  sourceA = Number(src.rows[0].id);
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await db.cleanup();
});

describe('access', () => {
  test('every report refuses a visitor who is not signed in', async () => {
    for (const path of [
      '/reports/candidate-status',
      '/reports/funnel',
      '/reports/sources',
      '/reports/positions',
      '/reports/weekly',
      '/reports/onboarding',
      '/reports/exit',
    ]) {
      assert.equal((await api(path)).status, 401, path);
    }
  });

  test('every report refuses a user without candidates.view', async () => {
    for (const path of ['/reports/candidate-status', '/reports/weekly', '/reports/exit']) {
      assert.equal((await api(path, { cookie: outsider.cookie })).status, 403, path);
    }
  });
});

describe('candidate status report', () => {
  before(async () => {
    await candidateAt('RPT-0001', 'applied', {
      createdAt: '2026-03-02T10:00:00+05:30',
      sourceId: sourceA,
    });
    await candidateAt('RPT-0002', 'rejected', { createdAt: '2026-03-04T10:00:00+05:30' });
    await candidateAt('RPT-0003', 'joined', {
      createdAt: '2026-03-10T10:00:00+05:30',
      positionId: positionB,
    });
  });

  test('lists candidates with their current stage', async () => {
    const res = await api('/reports/candidate-status', { cookie: admin.cookie });
    assert.equal(res.status, 200);
    assert.equal(res.body.total, 3);
    const joined = res.body.items.find((item) => item.candidateCode === 'RPT-0003');
    assert.equal(joined.stage, 'joined');
    assert.equal(joined.position, 'Report Position B');
  });

  test('filters by stage, position, source and date range', async () => {
    const byStage = await api('/reports/candidate-status?stage=rejected', { cookie: admin.cookie });
    assert.deepEqual(
      byStage.body.items.map((i) => i.candidateCode),
      ['RPT-0002'],
    );

    const byPosition = await api(`/reports/candidate-status?positionId=${positionB}`, {
      cookie: admin.cookie,
    });
    assert.deepEqual(
      byPosition.body.items.map((i) => i.candidateCode),
      ['RPT-0003'],
    );

    const bySource = await api(`/reports/candidate-status?sourceId=${sourceA}`, {
      cookie: admin.cookie,
    });
    assert.deepEqual(
      bySource.body.items.map((i) => i.candidateCode),
      ['RPT-0001'],
    );

    const byDate = await api('/reports/candidate-status?from=2026-03-03&to=2026-03-05', {
      cookie: admin.cookie,
    });
    assert.deepEqual(
      byDate.body.items.map((i) => i.candidateCode),
      ['RPT-0002'],
    );
  });
});

describe('funnel report', () => {
  test('counts current stages and period movements separately', async () => {
    const moved = await candidateAt('RPT-0101', 'interviewed', {
      createdAt: '2026-04-01T10:00:00+05:30',
    });
    await moveStage(moved, 'phone_screened', '2026-04-02T10:00:00+05:30');
    await moveStage(moved, 'interviewed', '2026-04-05T10:00:00+05:30');

    const res = await api('/reports/funnel?from=2026-04-01&to=2026-04-03', {
      cookie: admin.cookie,
    });
    assert.equal(res.status, 200);
    const stages = Object.fromEntries(res.body.stages.map((row) => [row.stage, row]));
    assert.equal(stages.phone_screened.entered, 1, 'movement inside the range counts');
    assert.equal(stages.interviewed.entered, 0, 'movement outside the range does not');
    assert.equal(stages.interviewed.current, 1, 'current position still counts');
    assert.equal(res.body.stages[0].stage, 'applied', 'stages come in pipeline order');
  });
});

describe('source and position reports', () => {
  test('break candidates down by outcome from their current stage', async () => {
    const res = await api('/reports/sources', { cookie: admin.cookie });
    assert.equal(res.status, 200);
    const rowA = res.body.items.find((item) => item.name === 'Report Source A');
    assert.equal(rowA.total, 1);
    assert.equal(rowA.inProgress, 1);
    const noSource = res.body.items.find((item) => item.name === '(not recorded)');
    assert.ok(noSource.total >= 3);
    assert.ok(noSource.hired >= 1);
    assert.ok(noSource.rejected >= 1);

    const positions = await api('/reports/positions', { cookie: admin.cookie });
    const rowB = positions.body.items.find((item) => item.name === 'Report Position B');
    assert.equal(rowB.hired, 1);
  });
});

describe('weekly report', () => {
  test('previous week runs Monday to Sunday and a weekStart must be a Monday', () => {
    assert.equal(isMonday('2026-03-02'), true);
    assert.equal(isMonday('2026-03-03'), false);
    // Wed 2026-10-14 in Colombo -> previous completed week starts Mon 2026-10-05.
    assert.equal(previousWeekStart(new Date('2026-10-14T12:00:00+05:30')), '2026-10-05');
    // Monday itself -> the week before.
    assert.equal(previousWeekStart(new Date('2026-10-12T00:30:00+05:30')), '2026-10-05');
    const parsed = parseWeeklyQuery({ weekStart: '2026-03-02' });
    assert.deepEqual([parsed.weekStart, parsed.weekEnd], ['2026-03-02', '2026-03-08']);
    const refused = parseWeeklyQuery(
      { weekStart: '2026-03-03' },
      new Date('2026-10-14T12:00:00+05:30'),
    );
    assert.equal(refused.weekStart, '2026-10-05', 'a non-Monday falls back to the previous week');
  });

  test('counts applications and movements inside the week only, Colombo days', async () => {
    // Monday 00:10 Colombo is inside the week; Sunday 23:50 Colombo is too.
    // The hour before Monday (Sunday 23:50 of the week before) is not.
    await candidateAt('RPT-0201', 'applied', { createdAt: '2026-06-01T00:10:00+05:30' });
    await candidateAt('RPT-0202', 'applied', { createdAt: '2026-06-07T23:50:00+05:30' });
    await candidateAt('RPT-0203', 'applied', { createdAt: '2026-05-31T23:50:00+05:30' });
    const mover = await candidateAt('RPT-0204', 'offer_sent', {
      createdAt: '2026-06-01T09:00:00+05:30',
    });
    await moveStage(mover, 'offer_sent', '2026-06-05T10:00:00+05:30');
    await moveStage(mover, 'joined', '2026-06-08T10:00:00+05:30'); // next week

    const res = await api('/reports/weekly?weekStart=2026-06-01', { cookie: admin.cookie });
    assert.equal(res.status, 200);
    assert.equal(res.body.weekStart, '2026-06-01');
    assert.equal(res.body.weekEnd, '2026-06-07');
    assert.equal(
      res.body.applications,
      3,
      'Mon 00:10 + Sun 23:50 + the mover; not the Sunday before',
    );
    assert.equal(res.body.offersSent, 1);
    assert.equal(res.body.joined, 0, 'next week movement excluded');
  });
});

describe('onboarding and exit reports', () => {
  before(async () => {
    const stays = await candidateAt('RPT-0301', 'joined', {
      createdAt: '2026-05-01T10:00:00+05:30',
    });
    const leaves = await candidateAt('RPT-0302', 'joined', {
      createdAt: '2026-05-01T10:00:00+05:30',
    });
    await db.pool.query(
      `INSERT INTO employees (candidate_id, join_date, current_phase, phase_start, phase_end, status) VALUES
       ($1, '2026-05-10', 'evaluation', '2026-05-10', '2026-05-16', 'active')`,
      [stays],
    );
    await db.pool.query(
      `INSERT INTO employees (candidate_id, join_date, current_phase, phase_start, phase_end, status,
                              exit_date, exit_reason)
       VALUES ($1, '2026-05-12', 'evaluation', '2026-05-12', NULL, 'discontinued',
               '2026-05-20', 'fictional exit reason')`,
      [leaves],
    );
  });

  test('onboarding lists employees by join date range', async () => {
    const res = await api('/reports/onboarding?from=2026-05-11&to=2026-05-31', {
      cookie: admin.cookie,
    });
    assert.deepEqual(
      res.body.items.map((i) => i.candidateCode),
      ['RPT-0302'],
    );
    const all = await api('/reports/onboarding', { cookie: admin.cookie });
    assert.ok(all.body.items.length >= 2);
  });

  test('exit lists only discontinued/terminated, with date and reason', async () => {
    const res = await api('/reports/exit', { cookie: admin.cookie });
    assert.deepEqual(
      res.body.items.map((i) => i.candidateCode),
      ['RPT-0302'],
    );
    assert.equal(res.body.items[0].exitReason, 'fictional exit reason');
    const filtered = await api('/reports/exit?from=2026-05-21', { cookie: admin.cookie });
    assert.deepEqual(filtered.body.items, []);
  });
});

describe('nothing sensitive leaks', () => {
  test('no report answer contains salary, hashes or credentials', async () => {
    for (const path of ['/reports/candidate-status', '/reports/weekly', '/reports/exit']) {
      const res = await api(path, { cookie: admin.cookie });
      const text = JSON.stringify(res.body).toLowerCase();
      for (const word of ['salary', 'password', 'hash', 'token', 'credential']) {
        assert.ok(!text.includes(word), `${path} must not contain "${word}"`);
      }
    }
  });
});
