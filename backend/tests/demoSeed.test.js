import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.js';
import {
  DEMO_DATABASE,
  SEEDER_EMAIL,
  SUPERVISOR_ROLE,
  countExisting,
  seedDemoData,
} from '../scripts/demoSeed.js';
import { createTestDatabase } from './helpers/testDb.js';

// The hosted-demo seed, run on a throwaway schema. Nothing here reads or writes
// the real recruitment tables, and every value is made up.

const run = promisify(execFile);
const SEED_CLI = fileURLToPath(new URL('../scripts/seed-demo-data.js', import.meta.url));

let db;
let server;
let base;
const supervisor = {
  fullName: 'Demo Supervisor',
  email: 'supervisor.test@example.test',
  password: `pw-${randomBytes(12).toString('base64url')}`,
};
const logs = [];

const query = async (sql, params = []) => (await db.pool.query(sql, params)).rows;

async function signIn(email, password) {
  const res = await fetch(`${base}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  return { status: res.status, cookie: res.headers.get('set-cookie')?.split(';')[0] };
}
const get = async (path, cookie) =>
  (await fetch(`${base}${path}`, { headers: { Cookie: cookie } })).status;

before(async () => {
  db = await createTestDatabase();
  await seedDemoData({ pool: db.pool, config: db.config, supervisor, log: (m) => logs.push(m) });
  server = createApp({ config: db.config, pool: db.pool }).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}/api`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await db.cleanup();
});

describe('the demo seed (fictional data, throwaway schema)', () => {
  test('creates nine fictional candidates spread over the whole pipeline', async () => {
    const stages = await query(
      `SELECT c.candidate_code, ps.current_stage
         FROM candidates c JOIN pipeline_status ps ON ps.candidate_id = c.id ORDER BY c.candidate_code`,
    );
    assert.equal(stages.length, 9);
    assert.deepEqual(
      stages.map((row) => row.current_stage),
      [
        'applied',
        'rejected', // not selected at the phone call
        'interview_scheduled',
        'offer_sent',
        'offer_accepted',
        'joined',
        'joined',
        'rejected',
        'on_hold',
      ],
    );
  });

  test('two employees: one in Evaluation, one that passed it and is in Probation', async () => {
    const employees = await query(
      `SELECT c.candidate_code, e.current_phase, e.status FROM employees e
         JOIN candidates c ON c.id = e.candidate_id ORDER BY c.candidate_code`,
    );
    assert.deepEqual(
      employees.map((row) => [row.current_phase, row.status]),
      [
        ['evaluation', 'active'],
        ['probation', 'active'],
      ],
    );
  });

  test('uses only made-up addresses and keeps the seeding account switched off', async () => {
    const addresses = await query(
      `SELECT email FROM candidates UNION ALL SELECT email FROM users WHERE email IS NOT NULL`,
    );
    for (const { email } of addresses) assert.ok(email.endsWith('@example.test'), email);

    const [seeder] = await query('SELECT id, is_active FROM users WHERE email = $1', [
      SEEDER_EMAIL,
    ]);
    assert.equal(seeder.is_active, false);
    assert.deepEqual(
      await query('SELECT 1 FROM user_sessions WHERE user_id = $1', [seeder.id]),
      [],
    );
  });

  test('the supervisor account is the restricted HR role and can sign in', async () => {
    const [row] = await query(
      `SELECT r.code FROM users u JOIN roles r ON r.id = u.role_id WHERE u.email = $1`,
      [supervisor.email],
    );
    assert.equal(row.code, SUPERVISOR_ROLE);

    const signedIn = await signIn(supervisor.email, supervisor.password);
    assert.equal(signedIn.status, 200);
    assert.equal(await get('/candidates', signedIn.cookie), 200);
    // No salary, no administration, for this account.
    assert.equal(await get('/salary/1', signedIn.cookie), 403);
    assert.equal(await get('/admin/users', signedIn.cookie), 403);
    assert.equal(await get('/admin/settings', signedIn.cookie), 403);
    assert.equal(await get('/admin/audit-log', signedIn.cookie), 403);
  });

  test('the switched-off seeding account cannot sign in', async () => {
    const attempt = await signIn(SEEDER_EMAIL, 'anything-at-all-123');
    assert.equal(attempt.status, 401);
  });

  test('the supervisor password is not written anywhere readable', async () => {
    assert.equal(logs.join('\n').includes(supervisor.password), false);
    const audit = JSON.stringify(await query('SELECT * FROM audit_log'));
    assert.equal(audit.includes(supervisor.password), false);
    const [credential] = await query(
      `SELECT password_hash FROM user_credentials uc JOIN users u ON u.id = uc.user_id WHERE u.email = $1`,
      [supervisor.email],
    );
    assert.match(credential.password_hash, /^\$argon2id\$/);
  });

  test('a second run is detected as occupied, so the command would refuse it', async () => {
    const existing = await countExisting(db.pool);
    assert.equal(existing.candidates, 9);
    assert.equal(existing.employees, 2);
    assert.equal(existing.historicalRecords, 0);
  });
});

describe('the seed command refuses anything but the hosted demo database', () => {
  const env = (overrides) => ({
    PATH: process.env.PATH,
    SystemRoot: process.env.SystemRoot,
    DB_HOST: 'db.example.test',
    DB_PORT: '5432',
    DB_NAME: DEMO_DATABASE,
    DB_USER: 'fictional_user',
    DB_PASSWORD: 'not-a-real-password',
    ...overrides,
  });
  const refuses = async (overrides, pattern) => {
    await assert.rejects(run(process.execPath, [SEED_CLI], { env: env(overrides) }), (err) => {
      assert.match(err.stderr, pattern);
      assert.equal(err.code, 1);
      return true;
    });
  };

  test('the real development database name is refused', async () => {
    await refuses(
      { DB_NAME: 'recruitment_system_dev' },
      /only fills the database named "recruitment_demo_dev"/,
    );
  });

  test('a name that does not end in _dev is refused', async () => {
    await refuses({ DB_NAME: 'recruitment_demo' }, /not a development database/);
  });

  test('production mode is refused', async () => {
    await refuses({ NODE_ENV: 'production' }, /production/);
  });

  test('a database on this computer is refused, before any connection is made', async () => {
    await refuses({ DB_HOST: 'localhost' }, /must be hosted, not on this computer/);
    await refuses({ DB_HOST: '127.0.0.1' }, /must be hosted/);
  });
});
