import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { createApp } from '../src/app.js';
import { readLifecycleSettings } from '../src/modules/employees/employees.repository.js';
import { createTestDatabase, createTestRole, createTestUser } from './helpers/testDb.js';

// Integration tests: a real server and real tables in a throwaway schema.
// Every name below is made up.

let db;
let server;
let baseUrl;
let admin;
let viewer; // candidates.view only - not an administrator

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

before(async () => {
  db = await createTestDatabase();
  server = createApp({ config: db.config, pool: db.pool }).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  await createTestRole(db.pool, 'viewer', ['candidates.view']);
  admin = await signedIn();
  viewer = await signedIn({ roleCode: 'viewer' });
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await db.cleanup();
});

describe('access', () => {
  test('settings refuse a visitor who is not signed in', async () => {
    assert.equal((await api('/admin/settings')).status, 401);
  });

  test('settings refuse a user without admin.manage', async () => {
    assert.equal((await api('/admin/settings', { cookie: viewer.cookie })).status, 403);
    assert.equal(
      (
        await api('/admin/settings/evaluation_days', {
          method: 'PATCH',
          cookie: viewer.cookie,
          body: { value: '9' },
        })
      ).status,
      403,
    );
  });
});

describe('listing and editing', () => {
  test('lists exactly the seeded settings with values and descriptions', async () => {
    const res = await api('/admin/settings', { cookie: admin.cookie });
    assert.equal(res.status, 200);
    const keys = res.body.items.map((item) => item.key);
    assert.deepEqual(keys, [
      'evaluation_days',
      'junior_months',
      'probation_max_extension_months',
      'probation_months',
    ]);
    const evaluation = res.body.items.find((item) => item.key === 'evaluation_days');
    assert.equal(evaluation.value, '7');
    assert.ok(evaluation.description.length > 0);
  });

  test('updates a value, records the audit entry, and Module 5 reads the new value', async () => {
    const res = await api('/admin/settings/evaluation_days', {
      method: 'PATCH',
      cookie: admin.cookie,
      body: { value: '10' },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.setting.value, '10');

    const audit = await db.pool.query(
      `SELECT actor_user_id, old_values, new_values, details FROM audit_log
        WHERE action = 'SETTING_UPDATE' ORDER BY id DESC LIMIT 1`,
    );
    assert.equal(Number(audit.rows[0].actor_user_id), admin.id);
    assert.deepEqual(audit.rows[0].old_values, { value: '7' });
    assert.deepEqual(audit.rows[0].new_values, { value: '10' });
    assert.deepEqual(audit.rows[0].details, { key: 'evaluation_days' });

    const lifecycle = await readLifecycleSettings(db.pool);
    assert.equal(lifecycle.evaluationDays, 10, 'Module 5 reads the updated value');

    // Restore for the other tests.
    await api('/admin/settings/evaluation_days', {
      method: 'PATCH',
      cookie: admin.cookie,
      body: { value: '7' },
    });
  });

  test('rejects values that are not whole numbers from 1 to 365', async () => {
    for (const value of ['0', '-3', '2.5', 'ten', '', '400']) {
      const res = await api('/admin/settings/probation_months', {
        method: 'PATCH',
        cookie: admin.cookie,
        body: { value },
      });
      assert.equal(res.status, 422, `"${value}" must be refused`);
    }
    const unchanged = await api('/admin/settings', { cookie: admin.cookie });
    assert.equal(unchanged.body.items.find((i) => i.key === 'probation_months').value, '3');
  });

  test('an unknown key is refused, never created', async () => {
    const res = await api('/admin/settings/invented_setting', {
      method: 'PATCH',
      cookie: admin.cookie,
      body: { value: '5' },
    });
    assert.equal(res.status, 404);
    const count = await db.pool.query('SELECT count(*)::int AS n FROM settings');
    assert.equal(count.rows[0].n, 4);
  });

  test('saving the same value again writes no duplicate audit row', async () => {
    const before_ = await db.pool.query(
      `SELECT count(*)::int AS n FROM audit_log WHERE action = 'SETTING_UPDATE'`,
    );
    await api('/admin/settings/junior_months', {
      method: 'PATCH',
      cookie: admin.cookie,
      body: { value: '9' },
    });
    const after_ = await db.pool.query(
      `SELECT count(*)::int AS n FROM audit_log WHERE action = 'SETTING_UPDATE'`,
    );
    assert.equal(after_.rows[0].n, before_.rows[0].n);
  });
});
