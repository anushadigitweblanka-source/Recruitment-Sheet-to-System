import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { createApp } from '../src/app.js';
import { createTestDatabase, createTestRole, createTestUser } from './helpers/testDb.js';

// Integration tests for the read-only roles and permissions view. A real
// server and real tables in a throwaway schema; every name and address below
// is made up. No role or permission is invented: the tests assert that the
// API returns exactly what the database holds.

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

describe('access control', () => {
  test('unauthenticated requests get 401', async () => {
    assert.equal((await api('/admin/roles')).status, 401);
    assert.equal((await api(`/admin/roles/${mainRoleId}`)).status, 401);
  });

  test('a user without admin.manage gets 403', async () => {
    assert.equal((await api('/admin/roles', { cookie: viewer.cookie })).status, 403);
    assert.equal((await api(`/admin/roles/${mainRoleId}`, { cookie: viewer.cookie })).status, 403);
  });
});

describe('listing', () => {
  test('the list is exactly the roles in the database, with their permissions', async () => {
    const res = await api('/admin/roles', { cookie: admin.cookie });
    assert.equal(res.status, 200);

    const dbRoles = await db.pool.query('SELECT code FROM roles ORDER BY code');
    assert.deepEqual(
      res.body.items.map((role) => role.code).sort(),
      dbRoles.rows.map((row) => row.code).sort(),
      'no role is invented or hidden',
    );

    const main = res.body.items.find((role) => role.code === 'main_user');
    const dbPerms = await db.pool.query(
      `SELECT p.code FROM role_permissions rp
         JOIN permissions p ON p.id = rp.permission_id
        WHERE rp.role_id = $1 ORDER BY p.code`,
      [mainRoleId],
    );
    assert.deepEqual(
      main.permissions,
      dbPerms.rows.map((row) => row.code),
      'exactly the assigned permission codes',
    );

    const testRole = res.body.items.find((role) => role.code === 'viewer');
    assert.deepEqual(testRole.permissions, ['candidates.view']);
  });

  test('the permission catalogue is exactly the permissions table', async () => {
    const res = await api('/admin/roles', { cookie: admin.cookie });
    const dbPerms = await db.pool.query('SELECT code FROM permissions ORDER BY code');
    assert.deepEqual(
      res.body.permissions.map((permission) => permission.code),
      dbPerms.rows.map((row) => row.code),
    );
  });

  test('user counts reflect role assignments', async () => {
    const res = await api('/admin/roles', { cookie: admin.cookie });
    const counts = await db.pool.query(
      'SELECT r.code, count(u.id)::int AS users FROM roles r LEFT JOIN users u ON u.role_id = r.id GROUP BY r.code',
    );
    for (const row of counts.rows) {
      const role = res.body.items.find((item) => item.code === row.code);
      assert.equal(role.userCount, row.users, `user count for ${row.code}`);
    }
  });

  test('roles carry only safe fields - no users, hashes or tokens', async () => {
    const res = await api('/admin/roles', { cookie: admin.cookie });
    for (const role of res.body.items) {
      assert.deepEqual(Object.keys(role).sort(), [
        'code',
        'description',
        'id',
        'name',
        'permissions',
        'userCount',
      ]);
    }
    const text = JSON.stringify(res.body);
    assert.ok(!text.includes('hash') && !text.includes('token') && !text.includes('@'));
  });
});

describe('single role', () => {
  test('one role by id, 404 for an unknown or malformed id', async () => {
    const res = await api(`/admin/roles/${mainRoleId}`, { cookie: admin.cookie });
    assert.equal(res.status, 200);
    assert.equal(res.body.role.code, 'main_user');
    assert.ok(res.body.role.permissions.includes('admin.manage'));

    assert.equal((await api('/admin/roles/999999', { cookie: admin.cookie })).status, 404);
    assert.equal((await api('/admin/roles/not-a-number', { cookie: admin.cookie })).status, 404);
  });
});

describe('read-only', () => {
  test('there is no create, edit, delete or assignment route', async () => {
    const attempts = [
      ['POST', '/admin/roles', { code: 'invented_role', name: 'Invented' }],
      ['PATCH', `/admin/roles/${mainRoleId}`, { name: 'Renamed' }],
      ['PUT', `/admin/roles/${mainRoleId}`, { name: 'Renamed' }],
      ['DELETE', `/admin/roles/${mainRoleId}`],
      ['POST', `/admin/roles/${mainRoleId}/permissions`, { code: 'salary.edit' }],
    ];
    for (const [method, path, body] of attempts) {
      const res = await api(path, { method, body, cookie: admin.cookie });
      assert.equal(res.status, 404, `${method} ${path} must not exist`);
    }

    const roles = await db.pool.query('SELECT count(*)::int AS n FROM roles');
    const rolePerms = await db.pool.query('SELECT count(*)::int AS n FROM role_permissions');
    assert.equal(roles.rows[0].n, 2, 'no role was created');
    assert.equal(rolePerms.rows[0].n, 10, 'role_permissions unchanged');
  });
});
