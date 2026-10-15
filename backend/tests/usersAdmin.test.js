import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { createApp } from '../src/app.js';
import { createTestDatabase, createTestRole, createTestUser } from './helpers/testDb.js';

// Integration tests for users administration. A real server and real tables
// in a throwaway schema; every name and address below is made up.

let db;
let server;
let baseUrl;
let admin;
let viewer;
let mainRoleId;

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

const login = (email, password) =>
  api('/auth/login', { method: 'POST', body: { email, password } });

const NEW_PASSWORD = 'fictional-password-123';
const RESET_PASSWORD = 'fictional-password-456';

before(async () => {
  db = await createTestDatabase();
  server = createApp({ config: db.config, pool: db.pool }).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  await createTestRole(db.pool, 'viewer', ['candidates.view']);
  admin = await signedIn();
  viewer = await signedIn({ roleCode: 'viewer' });
  mainRoleId = Number(
    (await db.pool.query(`SELECT id FROM roles WHERE code = 'main_user'`)).rows[0].id,
  );
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await db.cleanup();
});

describe('access', () => {
  test('refuses a visitor who is not signed in', async () => {
    assert.equal((await api('/admin/users')).status, 401);
  });

  test('refuses a user without admin.manage', async () => {
    assert.equal((await api('/admin/users', { cookie: viewer.cookie })).status, 403);
    assert.equal(
      (await api('/admin/users', { method: 'POST', cookie: viewer.cookie, body: {} })).status,
      403,
    );
  });
});

describe('listing', () => {
  test('lists safe fields only - never hashes, tokens or attempt counters', async () => {
    const res = await api('/admin/users', { cookie: admin.cookie });
    assert.equal(res.status, 200);
    assert.ok(res.body.items.length >= 2);
    const keys = Object.keys(res.body.items[0]).sort();
    assert.deepEqual(keys, [
      'createdAt',
      'email',
      'fullName',
      'id',
      'isActive',
      'lastLoginAt',
      'role',
    ]);
    const text = JSON.stringify(res.body).toLowerCase();
    for (const word of ['password', 'hash', 'token', 'credential', 'locked', 'attempts']) {
      assert.ok(!text.includes(word), `answer must not contain "${word}"`);
    }
  });

  test('the role list is exactly the roles in the database', async () => {
    const res = await api('/admin/users/roles', { cookie: admin.cookie });
    assert.deepEqual(
      res.body.items.map((role) => role.code).sort(),
      ['main_user', 'outsider', 'viewer'].filter(
        (code) => code !== 'outsider', // this file seeds only viewer
      ),
    );
  });
});

describe('creating a user', () => {
  test('creates the user and credential atomically, hashed, and audits it', async () => {
    const res = await api('/admin/users', {
      method: 'POST',
      cookie: admin.cookie,
      body: {
        fullName: 'Users Test Person',
        email: 'Users-Test@Example.Test ',
        roleId: mainRoleId,
        password: NEW_PASSWORD,
      },
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.user.email, 'users-test@example.test', 'email normalized');
    assert.equal(res.body.user.isActive, true);

    const cred = await db.pool.query(
      `SELECT c.password_hash FROM user_credentials c
        JOIN users u ON u.id = c.user_id WHERE u.email = 'users-test@example.test'`,
    );
    assert.match(cred.rows[0].password_hash, /^\$argon2id\$/, 'stored as Argon2id only');
    assert.ok(!cred.rows[0].password_hash.includes(NEW_PASSWORD), 'plain password absent');

    const audit = await db.pool.query(
      `SELECT new_values FROM audit_log WHERE action = 'USER_CREATE' ORDER BY id DESC LIMIT 1`,
    );
    assert.equal(audit.rows[0].new_values.email, 'users-test@example.test');
    assert.equal(audit.rows[0].new_values.password, undefined, 'no password in the audit');

    const signin = await login('users-test@example.test', NEW_PASSWORD);
    assert.equal(signin.status, 200, 'the new user can sign in');
  });

  test('rejects a duplicate email, a missing name, a bad role and a short password', async () => {
    const dup = await api('/admin/users', {
      method: 'POST',
      cookie: admin.cookie,
      body: {
        fullName: 'Duplicate Person',
        email: 'users-test@example.test',
        roleId: mainRoleId,
        password: NEW_PASSWORD,
      },
    });
    assert.equal(dup.status, 422);
    assert.match(dup.body.fields.email, /already exists/);

    const bad = await api('/admin/users', {
      method: 'POST',
      cookie: admin.cookie,
      body: { fullName: '', email: 'not-an-email', roleId: 999999, password: 'short' },
    });
    assert.equal(bad.status, 422);
    assert.ok(bad.body.fields.fullName);
    assert.ok(bad.body.fields.email);
    assert.ok(bad.body.fields.roleId);
    assert.ok(bad.body.fields.password);
  });
});

describe('deactivate and reactivate', () => {
  test('a deactivated user cannot sign in and is signed out everywhere; reactivation restores access', async () => {
    const target = (await api('/admin/users', { cookie: admin.cookie })).body.items.find(
      (user) => user.email === 'users-test@example.test',
    );

    // The user has a live session from the previous test.
    const sessionsBefore = await db.pool.query(
      'SELECT count(*)::int AS n FROM user_sessions WHERE user_id = $1',
      [target.id],
    );
    assert.ok(sessionsBefore.rows[0].n >= 1);

    const off = await api(`/admin/users/${target.id}/status`, {
      method: 'PATCH',
      cookie: admin.cookie,
      body: { isActive: false },
    });
    assert.equal(off.status, 200);
    assert.equal(off.body.user.isActive, false);

    const sessionsAfter = await db.pool.query(
      'SELECT count(*)::int AS n FROM user_sessions WHERE user_id = $1',
      [target.id],
    );
    assert.equal(sessionsAfter.rows[0].n, 0, 'existing sessions removed');
    // A deactivated account is refused with the same 401 as a wrong password,
    // so the answer does not reveal whether the account exists or its state.
    assert.equal((await login(target.email, NEW_PASSWORD)).status, 401, 'sign-in refused');

    const on = await api(`/admin/users/${target.id}/status`, {
      method: 'PATCH',
      cookie: admin.cookie,
      body: { isActive: true },
    });
    assert.equal(on.body.user.isActive, true);
    assert.equal((await login(target.email, NEW_PASSWORD)).status, 200, 'sign-in works again');

    const actions = await db.pool.query(
      `SELECT action FROM audit_log
        WHERE entity_type = 'users' AND entity_id = $1
          AND action IN ('USER_DEACTIVATE', 'USER_REACTIVATE') ORDER BY id`,
      [target.id],
    );
    assert.deepEqual(
      actions.rows.map((row) => row.action),
      ['USER_DEACTIVATE', 'USER_REACTIVATE'],
    );
  });

  test('an administrator cannot deactivate their own account', async () => {
    const res = await api(`/admin/users/${admin.id}/status`, {
      method: 'PATCH',
      cookie: admin.cookie,
      body: { isActive: false },
    });
    assert.equal(res.status, 422);
  });
});

describe('password reset', () => {
  test('the old password stops working, the new one works, nothing secret is audited', async () => {
    const target = (await api('/admin/users', { cookie: admin.cookie })).body.items.find(
      (user) => user.email === 'users-test@example.test',
    );

    const res = await api(`/admin/users/${target.id}/reset-password`, {
      method: 'POST',
      cookie: admin.cookie,
      body: { password: RESET_PASSWORD },
    });
    assert.equal(res.status, 200);

    assert.equal((await login(target.email, NEW_PASSWORD)).status, 401, 'old password refused');
    assert.equal((await login(target.email, RESET_PASSWORD)).status, 200, 'new password works');

    const audit = await db.pool.query(
      `SELECT old_values, new_values, details FROM audit_log
        WHERE action = 'USER_PASSWORD_RESET' ORDER BY id DESC LIMIT 1`,
    );
    const text = JSON.stringify(audit.rows[0]);
    assert.ok(!text.includes(RESET_PASSWORD) && !text.includes(NEW_PASSWORD), 'no password value');

    const short = await api(`/admin/users/${target.id}/reset-password`, {
      method: 'POST',
      cookie: admin.cookie,
      body: { password: 'short' },
    });
    assert.equal(short.status, 422);
  });
});

describe('no deletion', () => {
  test('users cannot be deleted through the API', async () => {
    const target = (await api('/admin/users', { cookie: admin.cookie })).body.items[0];
    const res = await fetch(`${baseUrl}/api/admin/users/${target.id}`, {
      method: 'DELETE',
      headers: { Cookie: admin.cookie },
    });
    assert.equal(res.status, 404, 'no DELETE route exists');
  });
});
