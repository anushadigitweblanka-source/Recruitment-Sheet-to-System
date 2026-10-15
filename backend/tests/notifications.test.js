import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { createApp } from '../src/app.js';
import { createMailService } from '../src/modules/notifications/mailService.js';
import { runNotificationScheduler } from '../src/modules/notifications/notifications.service.js';
import { createTestDatabase, createTestRole, createTestUser } from './helpers/testDb.js';

// Integration tests: a real server and real tables, in a throwaway schema.
// Every name, address and phone number below is made up. No mail leaves the
// machine: the development adapter delivers nothing, and the failure tests
// use a fake that throws.

let db;
let server;
let baseUrl;
let admin; // holds every permission
let viewer; // may view, cannot manage notifications
let outsider; // holds no permission
let nextCode = 1;

const devMail = createMailService();
const brokenMail = {
  mode: 'test-broken',
  send: async () => {
    throw new Error('simulated outage');
  },
};

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

async function newCandidate(overrides = {}) {
  const n = nextCode;
  nextCode += 1;
  const res = await api('/candidates', {
    method: 'POST',
    cookie: admin.cookie,
    body: {
      candidateCode: `NT-${String(n).padStart(4, '0')}`,
      fullName: `Notify Sample ${n}`,
      phone: `07500${String(n).padStart(5, '0')}`,
      ...overrides,
    },
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.candidate;
}

// Reminders are created by the application's future hooks; the tests write
// the schedule rows directly, as development data would be.
async function insertNotification({
  candidateId,
  type = 'cv_pending',
  dueAt = new Date(Date.now() + 60 * 60 * 1000),
  sendAt = new Date(Date.now() - 60 * 1000),
  recipients = ['hr.sample@example.test'],
  status = 'pending',
}) {
  const { rows } = await db.pool.query(
    `INSERT INTO notifications (candidate_id, type, due_at, send_at, recipients, status)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [candidateId, type, dueAt, sendAt, recipients, status],
  );
  return Number(rows[0].id);
}

async function newTemplate(body, who = admin) {
  const res = await api('/email-templates', { method: 'POST', cookie: who.cookie, body });
  return res;
}

const notificationRow = async (id) =>
  (await db.pool.query('SELECT * FROM notifications WHERE id = $1', [id])).rows[0];
const logRowsFor = async (notificationId) =>
  (
    await db.pool.query('SELECT * FROM email_log WHERE notification_id = $1 ORDER BY id', [
      notificationId,
    ])
  ).rows;
const auditActions = async (entityType, entityId) =>
  (
    await db.pool.query(
      'SELECT action FROM audit_log WHERE entity_type = $1 AND entity_id = $2 ORDER BY id',
      [entityType, entityId],
    )
  ).rows.map((row) => row.action);

const run = (mail = devMail) => runNotificationScheduler(db.pool, mail);

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
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await db.cleanup();
});

describe('access', () => {
  test('every route refuses a visitor who is not signed in', async () => {
    assert.equal((await api('/notifications')).status, 401);
    assert.equal((await api('/notifications/1')).status, 401);
    assert.equal((await api('/notifications/run', { method: 'POST' })).status, 401);
    assert.equal((await api('/email-templates')).status, 401);
    assert.equal((await api('/email-templates', { method: 'POST', body: {} })).status, 401);
    assert.equal((await api('/email-log')).status, 401);
    assert.equal((await api('/email-log/1/resend', { method: 'POST' })).status, 401);
  });

  test('a user with no permission is refused', async () => {
    assert.equal((await api('/notifications', { cookie: outsider.cookie })).status, 403);
    assert.equal((await api('/email-templates', { cookie: outsider.cookie })).status, 403);
    assert.equal((await api('/email-log', { cookie: outsider.cookie })).status, 403);
  });

  test('a view-only user can read everything but change nothing', async () => {
    assert.equal((await api('/notifications', { cookie: viewer.cookie })).status, 200);
    assert.equal((await api('/email-templates', { cookie: viewer.cookie })).status, 200);
    assert.equal((await api('/email-log', { cookie: viewer.cookie })).status, 200);

    assert.equal(
      (await newTemplate({ type: 'viewer_try', subject: 'x', body: 'x' }, viewer)).status,
      403,
    );
    assert.equal(
      (await api('/notifications/run', { method: 'POST', cookie: viewer.cookie })).status,
      403,
    );
    assert.equal(
      (await api('/email-log/1/resend', { method: 'POST', cookie: viewer.cookie })).status,
      403,
    );
  });

  test('the development trigger is refused in production', async () => {
    const prodServer = createApp({
      config: { ...db.config, environment: 'production' },
      pool: db.pool,
    }).listen(0, '127.0.0.1');
    await new Promise((resolve) => prodServer.once('listening', resolve));
    const port = prodServer.address().port;

    const res = await fetch(`http://127.0.0.1:${port}/api/notifications/run`, {
      method: 'POST',
      headers: { Cookie: admin.cookie },
    });

    assert.equal(res.status, 403);
    assert.match((await res.json()).message, /production/);
    await new Promise((resolve) => prodServer.close(resolve));
  });
});

describe('email templates', () => {
  test('creates a template, returns it, and audits the creation', async () => {
    const res = await newTemplate({
      type: 'status_rejected_on_hold',
      subject: 'Hello {name}',
      body: 'Sample body for {name} ({candidate_code}).',
    });

    assert.equal(res.status, 201);
    const { template } = res.body;
    assert.equal(template.type, 'status_rejected_on_hold');
    assert.equal(template.subject, 'Hello {name}');
    // The guide gives this mail One-click, so that is the default.
    assert.equal(template.sendMode, 'one_click');
    assert.equal(template.isActive, true);
    assert.deepEqual(await auditActions('email_templates', template.id), ['EMAIL_TEMPLATE_CREATE']);
  });

  test('reports badly formed values field by field', async () => {
    const res = await newTemplate({
      type: 'Not A Slug',
      subject: '',
      body: 'x'.repeat(10001),
      sendMode: 'maybe',
      isActive: 'yes',
    });

    assert.equal(res.status, 422);
    assert.deepEqual(Object.keys(res.body.fields).sort(), [
      'body',
      'isActive',
      'sendMode',
      'subject',
      'type',
    ]);
  });

  test('a second template with the same type is refused', async () => {
    await newTemplate({ type: 'joining_onboarding', subject: 's', body: 'b' });
    const res = await newTemplate({ type: 'joining_onboarding', subject: 's2', body: 'b2' });

    assert.equal(res.status, 422);
    assert.match(res.body.fields.type, /already exists/);
  });

  test('edits only the fields sent, audits the change, and can switch a template off', async () => {
    const { body } = await newTemplate({
      type: 'team_lead_summary',
      subject: 'Old',
      body: 'Old body',
    });
    const id = body.template.id;

    const res = await api(`/email-templates/${id}`, {
      method: 'PATCH',
      cookie: admin.cookie,
      body: { subject: 'New', isActive: false },
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.template.subject, 'New');
    assert.equal(res.body.template.body, 'Old body');
    assert.equal(res.body.template.isActive, false);
    assert.deepEqual(await auditActions('email_templates', id), [
      'EMAIL_TEMPLATE_CREATE',
      'EMAIL_TEMPLATE_UPDATE',
    ]);

    // The active filter sees the change.
    const inactive = await api('/email-templates?active=false', { cookie: admin.cookie });
    assert.ok(inactive.body.items.some((t) => t.id === id));
    const active = await api('/email-templates?active=true', { cookie: admin.cookie });
    assert.ok(!active.body.items.some((t) => t.id === id));
  });

  test('an edit that changes nothing audits nothing; a bad edit saves nothing', async () => {
    const { body } = await newTemplate({
      type: 'interview_invitation',
      subject: 'S',
      body: 'B',
    });
    const id = body.template.id;

    await api(`/email-templates/${id}`, {
      method: 'PATCH',
      cookie: admin.cookie,
      body: { subject: 'S' },
    });
    assert.deepEqual(await auditActions('email_templates', id), ['EMAIL_TEMPLATE_CREATE']);

    const bad = await api(`/email-templates/${id}`, {
      method: 'PATCH',
      cookie: admin.cookie,
      body: { subject: '' },
    });
    assert.equal(bad.status, 422);
    assert.equal(
      (await api(`/email-templates/${id}`, { cookie: admin.cookie })).body.template.subject,
      'S',
    );
  });

  test('answers "not found" for an unknown template', async () => {
    assert.equal((await api('/email-templates/999999', { cookie: admin.cookie })).status, 404);
    assert.equal(
      (
        await api('/email-templates/999999', {
          method: 'PATCH',
          cookie: admin.cookie,
          body: { subject: 'x' },
        })
      ).status,
      404,
    );
  });
});

describe('the sending rule', () => {
  before(async () => {
    // The template the cv_pending reminders are rendered from.
    await newTemplate({
      type: 'cv_pending_reminder',
      subject: 'CV reminder for {name}',
      body: 'Sample reminder text for {name} ({candidate_code}).',
    });
  });

  test('a due reminder is sent: sent_at set, log row written, audit recorded', async () => {
    const candidate = await newCandidate();
    const id = await insertNotification({ candidateId: candidate.id });

    const summary = await run();

    assert.equal(summary.sent >= 1, true);
    const row = await notificationRow(id);
    assert.equal(row.status, 'sent');
    assert.notEqual(row.sent_at, null);
    assert.equal(Number(row.attempts), 1);

    const logs = await logRowsFor(id);
    assert.equal(logs.length, 1);
    assert.equal(logs[0].status, 'sent');
    assert.equal(logs[0].subject_sent, `CV reminder for ${candidate.fullName}`);
    assert.match(logs[0].body_sent, new RegExp(candidate.candidateCode));
    assert.deepEqual(logs[0].to_addresses, ['hr.sample@example.test']);
    assert.equal(logs[0].is_resend, false);
    assert.equal(logs[0].sent_by, null);
    assert.deepEqual(await auditActions('email_log', Number(logs[0].id)), ['EMAIL_SEND']);
  });

  test('a reminder whose send time has not come is left alone', async () => {
    const candidate = await newCandidate();
    const id = await insertNotification({
      candidateId: candidate.id,
      sendAt: new Date(Date.now() + 60 * 60 * 1000),
      dueAt: new Date(Date.now() + 25 * 60 * 60 * 1000),
    });

    await run();

    const row = await notificationRow(id);
    assert.equal(row.status, 'pending');
    assert.equal(row.sent_at, null);
    assert.deepEqual(await logRowsFor(id), []);
  });

  test('a second run does not send the same reminder again', async () => {
    const candidate = await newCandidate();
    const id = await insertNotification({ candidateId: candidate.id });

    await run();
    const sentAt = (await notificationRow(id)).sent_at;
    const again = await run();

    assert.equal((await notificationRow(id)).sent_at.getTime(), sentAt.getTime());
    assert.equal((await logRowsFor(id)).length, 1);
    assert.equal(again.sent, 0);
  });

  test('two overlapping runs send one mail, not two', async () => {
    const candidate = await newCandidate();
    const id = await insertNotification({ candidateId: candidate.id });

    await Promise.all([run(), run()]);

    assert.equal((await logRowsFor(id)).length, 1);
    assert.equal((await notificationRow(id)).status, 'sent');
  });

  test('without an active template the reminder fails and says why', async () => {
    const candidate = await newCandidate();
    const nId = await insertNotification({ candidateId: candidate.id });
    await db.pool.query(
      `UPDATE email_templates SET is_active = false WHERE type = 'cv_pending_reminder'`,
    );

    try {
      await run();
      const row = await notificationRow(nId);
      assert.equal(row.status, 'failed');
      assert.match(row.last_error, /No active email template/);
      assert.equal(Number(row.attempts), 1);
      assert.deepEqual(await logRowsFor(nId), []);
      assert.deepEqual(await auditActions('notifications', nId), ['EMAIL_SEND_FAILED']);
    } finally {
      await db.pool.query(
        `UPDATE email_templates SET is_active = true WHERE type = 'cv_pending_reminder'`,
      );
    }
  });

  test('a recipient that is not an email address fails the reminder', async () => {
    const candidate = await newCandidate();
    const id = await insertNotification({
      candidateId: candidate.id,
      recipients: ['not-an-address'],
    });

    await run();

    const row = await notificationRow(id);
    assert.equal(row.status, 'failed');
    assert.match(row.last_error, /not-an-address/);
  });

  test('a delivery failure marks the reminder and the log row failed, and the run continues', async () => {
    const first = await newCandidate();
    const second = await newCandidate();
    const failingId = await insertNotification({ candidateId: first.id });
    const okId = await insertNotification({ candidateId: second.id });

    const summary = await run(brokenMail);

    const failedRow = await notificationRow(failingId);
    assert.equal(failedRow.status, 'failed');
    assert.match(failedRow.last_error, /simulated outage/);
    const logs = await logRowsFor(failingId);
    assert.equal(logs.length, 1);
    assert.equal(logs[0].status, 'failed');
    assert.match(logs[0].error, /simulated outage/);
    // Both rows were attempted: one failure never stops the run.
    assert.equal((await notificationRow(okId)).status, 'failed');
    assert.equal(summary.failed, 2);
    assert.equal(summary.checked, 2);
  });

  test('two live reminders of the same type for one subject cannot even be scheduled', async () => {
    const candidate = await newCandidate();
    await insertNotification({ candidateId: candidate.id });

    await assert.rejects(
      insertNotification({ candidateId: candidate.id }),
      /notifications_one_cv_chase/,
    );
  });

  test('a reminder already mailed is not sent again by the scheduler', async () => {
    const candidate = await newCandidate();
    const id = await insertNotification({ candidateId: candidate.id });
    // The mail for this reminder already went out (a crash left the
    // reminder itself still pending).
    const template = (
      await db.pool.query(`SELECT id FROM email_templates WHERE type = 'cv_pending_reminder'`)
    ).rows[0];
    await db.pool.query(
      `INSERT INTO email_log (candidate_id, template_id, notification_id, to_addresses, subject_sent, status, sent_at)
       VALUES ($1, $2, $3, ARRAY['hr.sample@example.test'], 'Sample', 'sent', now())`,
      [candidate.id, template.id, id],
    );

    await run();

    const row = await notificationRow(id);
    assert.equal(row.status, 'failed');
    assert.match(row.last_error, /already sent.*Resend/);
    // Only the earlier row exists: the scheduler added none.
    assert.equal((await logRowsFor(id)).length, 1);
    assert.deepEqual(await auditActions('notifications', id), ['EMAIL_SEND_FAILED']);
  });
});

describe('the notification list', () => {
  let listed;

  before(async () => {
    listed = await newCandidate({ fullName: 'Notify Numbat', candidateCode: 'NTL-0001' });
    await insertNotification({
      candidateId: listed.id,
      type: 'cv_pending',
      status: 'cancelled',
      dueAt: '2026-12-01T12:00:00Z',
      sendAt: '2026-11-30T12:00:00Z',
    });
  });

  test('lists reminders with their candidate, newest send time first', async () => {
    const res = await api('/notifications?search=Notify+Numbat', { cookie: admin.cookie });

    assert.equal(res.status, 200);
    assert.equal(res.body.total, 1);
    const item = res.body.items[0];
    assert.equal(item.candidate.candidateCode, 'NTL-0001');
    assert.equal(item.type, 'cv_pending');
    assert.equal(item.status, 'cancelled');
    assert.deepEqual(item.recipients, ['hr.sample@example.test']);
    assert.equal(res.body.mailMode, 'development');
  });

  test('filters by type, status, sent flag and due date', async () => {
    const q = (query) =>
      api(`/notifications?search=Notify+Numbat&${query}`, { cookie: admin.cookie });

    assert.equal((await q('type=cv_pending')).body.total, 1);
    assert.equal((await q('type=probation_end')).body.total, 0);
    assert.equal((await q('status=cancelled')).body.total, 1);
    assert.equal((await q('status=sent')).body.total, 0);
    assert.equal((await q('sent=false')).body.total, 1);
    assert.equal((await q('sent=true')).body.total, 0);
    assert.equal((await q('dueFrom=2026-12-01&dueTo=2026-12-01')).body.total, 1);
    assert.equal((await q('dueFrom=2026-12-02')).body.total, 0);
  });

  test('answers one reminder, and "not found" for an unknown id', async () => {
    const list = await api('/notifications?search=Notify+Numbat', { cookie: admin.cookie });
    const id = list.body.items[0].id;

    const one = await api(`/notifications/${id}`, { cookie: admin.cookie });
    assert.equal(one.status, 200);
    assert.equal(one.body.notification.candidate.fullName, 'Notify Numbat');
    assert.equal((await api('/notifications/999999', { cookie: admin.cookie })).status, 404);
  });
});

describe('the email log and resend', () => {
  let candidate;
  let sentLogId;

  before(async () => {
    candidate = await newCandidate({ fullName: 'Resend Numbat' });
    const id = await insertNotification({ candidateId: candidate.id });
    await run();
    sentLogId = Number((await logRowsFor(id))[0].id);
  });

  test('lists the delivery history with filters', async () => {
    const res = await api('/email-log?recipient=hr.sample', { cookie: admin.cookie });

    assert.equal(res.status, 200);
    assert.ok(res.body.total >= 1);
    const entry = res.body.items.find((item) => item.id === sentLogId);
    assert.equal(entry.candidate.fullName, 'Resend Numbat');
    assert.equal(entry.template.type, 'cv_pending_reminder');
    assert.equal(entry.status, 'sent');
    assert.equal(entry.isResend, false);

    assert.ok((await api('/email-log?status=sent', { cookie: admin.cookie })).body.total >= 1);
    assert.equal(
      (await api('/email-log?recipient=nobody@nowhere', { cookie: admin.cookie })).body.total,
      0,
    );
  });

  test('an explicit resend adds a marked row, keeps the original, and audits who did it', async () => {
    const res = await api(`/email-log/${sentLogId}/resend`, {
      method: 'POST',
      cookie: admin.cookie,
    });

    assert.equal(res.status, 201);
    const { entry } = res.body;
    assert.notEqual(entry.id, sentLogId);
    assert.equal(entry.isResend, true);
    assert.equal(entry.status, 'sent');
    assert.equal(entry.sentBy, 'Test User');
    assert.equal(entry.subjectSent, `CV reminder for ${candidate.fullName}`);

    const original = (
      await db.pool.query('SELECT status, is_resend FROM email_log WHERE id = $1', [sentLogId])
    ).rows[0];
    assert.equal(original.status, 'sent');
    assert.equal(original.is_resend, false);

    const audit = (
      await db.pool.query(
        `SELECT actor_user_id, details FROM audit_log
          WHERE action = 'EMAIL_RESEND' AND entity_id = $1`,
        [entry.id],
      )
    ).rows[0];
    assert.equal(Number(audit.actor_user_id), admin.id);
    assert.equal(Number(audit.details.originalLogId), sentLogId);
  });

  test('answers "not found" for an unknown log entry', async () => {
    assert.equal(
      (await api('/email-log/999999/resend', { method: 'POST', cookie: admin.cookie })).status,
      404,
    );
  });
});

describe('database rules', () => {
  test('the subject link must match the type', async () => {
    const candidate = await newCandidate();
    const insert = (type, extraColumn, extraValue) =>
      db.pool.query(
        `INSERT INTO notifications (candidate_id, type, due_at, send_at, recipients${extraColumn ? `, ${extraColumn}` : ''})
         VALUES ($1, $2, now(), now(), ARRAY['a@b.test']${extraValue ? `, ${extraValue}` : ''})`,
        [candidate.id, type],
      );

    // A phase reminder needs its phase row; a CV chase must not have one.
    await assert.rejects(insert('evaluation_end'), /notifications_subject_matches_type/);
    await assert.rejects(insert('interview_reminder'), /notifications_subject_matches_type/);
    await assert.rejects(insert('joining_reminder'), /notifications_subject_matches_type/);
  });

  test('send_at may not come after due_at, and status must agree with sent_at', async () => {
    const candidate = await newCandidate();

    await assert.rejects(
      db.pool.query(
        `INSERT INTO notifications (candidate_id, type, due_at, send_at, recipients)
         VALUES ($1, 'cv_pending', now(), now() + interval '1 hour', ARRAY['a@b.test'])`,
        [candidate.id],
      ),
      /notifications_send_before_due/,
    );
    await assert.rejects(
      db.pool.query(
        `INSERT INTO notifications (candidate_id, type, due_at, send_at, recipients, status)
         VALUES ($1, 'cv_pending', now(), now(), ARRAY['a@b.test'], 'sent')`,
        [candidate.id],
      ),
      /notifications_sent_consistent/,
    );
    await assert.rejects(
      db.pool.query(
        `INSERT INTO notifications (candidate_id, type, due_at, send_at, recipients)
         VALUES ($1, 'cv_pending', now(), now(), ARRAY[]::text[])`,
        [candidate.id],
      ),
      /notifications_recipients_present/,
    );
  });

  test('the same template cannot be queued twice for a candidate unless it is a resend', async () => {
    const candidate = await newCandidate();
    const template = (
      await db.pool.query(`SELECT id FROM email_templates WHERE type = 'cv_pending_reminder'`)
    ).rows[0];
    const insert = (isResend) =>
      db.pool.query(
        `INSERT INTO email_log (candidate_id, template_id, to_addresses, subject_sent, is_resend)
         VALUES ($1, $2, ARRAY['a@b.test'], 'Sample', $3)`,
        [candidate.id, template.id, isResend],
      );

    await insert(false);
    await assert.rejects(insert(false), /email_log_once_per_candidate/);
    await insert(true); // an explicit resend is allowed
  });
});
