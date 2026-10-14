import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { createApp } from '../src/app.js';
import { recordAudit } from '../src/modules/audit/audit.js';
import { createTestDatabase, createTestRole, createTestUser } from './helpers/testDb.js';

// Integration tests for the read-only audit log viewer. Every name below is
// made up.

let db;
let server;
let baseUrl;
let admin;
let viewer;

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

before(async () => {
  db = await createTestDatabase();
  server = createApp({ config: db.config, pool: db.pool }).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  await createTestRole(db.pool, 'viewer', ['candidates.view']);
  admin = await signedIn();
  viewer = await signedIn({ roleCode: 'viewer' });

  // Some entries to read back, written through the real helper.
  await recordAudit(db.pool, {
    actorUserId: admin.id,
    action: 'SAMPLE_ACTION_ONE',
    entityType: 'candidates',
    entityId: 1,
    details: { note: 'fictional entry one' },
  });
  await recordAudit(db.pool, {
    action: 'SAMPLE_ACTION_TWO',
    entityType: 'settings',
    oldValues: { value: '7' },
    newValues: { value: '9' },
  });
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await db.cleanup();
});

describe('access', () => {
  test('refuses a visitor who is not signed in', async () => {
    assert.equal((await api('/admin/audit-log')).status, 401);
  });

  test('refuses a user without admin.manage', async () => {
    assert.equal((await api('/admin/audit-log', { cookie: viewer.cookie })).status, 403);
  });
});

describe('reading', () => {
  test('lists entries newest first with actor, payloads and pagination', async () => {
    const res = await api('/admin/audit-log?pageSize=5', { cookie: admin.cookie });
    assert.equal(res.status, 200);
    assert.ok(res.body.total >= 2, 'sign-ins and samples are recorded');
    assert.ok(res.body.items[0].id > res.body.items[1].id, 'newest first');

    const sample = res.body.items.find((item) => item.action === 'SAMPLE_ACTION_TWO');
    assert.equal(sample.actor, null, 'system entry has no actor');
    assert.deepEqual(sample.oldValues, { value: '7' });
    assert.deepEqual(sample.newValues, { value: '9' });

    const page2 = await api('/admin/audit-log?pageSize=2&page=2', { cookie: admin.cookie });
    assert.equal(page2.body.items.length, 2);
    assert.notEqual(page2.body.items[0].id, res.body.items[0].id);
  });

  test('filters by action, entity type and actor', async () => {
    const byAction = await api('/admin/audit-log?action=SAMPLE_ACTION_ONE', {
      cookie: admin.cookie,
    });
    assert.equal(byAction.body.total, 1);
    assert.equal(byAction.body.items[0].actor.name, 'Test User');

    const byEntity = await api('/admin/audit-log?entityType=settings', { cookie: admin.cookie });
    assert.ok(byEntity.body.items.every((item) => item.entityType === 'settings'));

    const byActor = await api(`/admin/audit-log?actorUserId=${admin.id}`, {
      cookie: admin.cookie,
    });
    assert.ok(byActor.body.items.every((item) => item.actor !== null));

    const byDate = await api('/admin/audit-log?from=2020-01-01&to=2020-01-02', {
      cookie: admin.cookie,
    });
    assert.equal(byDate.body.total, 0, 'date range filter applies');
  });

  test('the log is append-only: no write routes exist', async () => {
    for (const method of ['POST', 'PATCH', 'PUT', 'DELETE']) {
      const res = await fetch(`${baseUrl}/api/admin/audit-log`, {
        method,
        headers: { Cookie: admin.cookie, 'Content-Type': 'application/json' },
        body: '{}',
      });
      assert.equal(res.status, 404, `${method} must not exist`);
    }
  });

  test('no entry can contain password, hash, token, secret or salary keys', async () => {
    // The writer refuses them; prove it here so the viewer can never show one.
    await assert.rejects(
      recordAudit(db.pool, { action: 'BAD_ENTRY', details: { password: 'x' } }),
      /must not contain/,
    );
    const res = await api('/admin/audit-log?pageSize=100', { cookie: admin.cookie });
    const text = JSON.stringify(res.body).toLowerCase();
    for (const word of ['password', 'token', 'secret', 'salary']) {
      assert.ok(!text.includes(`"${word}"`), `no stored key named "${word}"`);
    }
  });
});
