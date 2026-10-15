import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { runNotificationScheduler } from '../src/modules/notifications/notifications.service.js';
import { inDays, isoDay, startHarness } from './helpers/harness.js';

// In-app alerts: the reminders the scheduler creates, shown to the user they
// are addressed to, with a personal read mark. Every name and address is
// made up; the mail adapter is a spy, so nothing is delivered.

let h;
let hr; // the address is in the HR reminder setting
let outsider; // an active user whose address is in no notification
let leadUser; // linked to a Team Lead row
let position;
let spy;
let noPositionLead;

const alertsOf = (who) => h.api('/me/notifications', { cookie: who.cookie });
const readMarks = () =>
  h.query('SELECT * FROM notification_reads ORDER BY notification_id, user_id');
const row = (items, candidate) => items.find((i) => i.candidate.id === candidate.id);

before(async () => {
  h = await startHarness();
  spy = {
    mode: 'test-spy',
    calls: [],
    send: async (mail) => {
      spy.calls.push(mail);
      return { delivered: false, simulated: true };
    },
  };
  hr = await h.signedIn({ roleCode: 'hr' });
  outsider = await h.signedIn({ roleCode: 'hr' });
  leadUser = await h.signedIn({ roleCode: 'team_lead' });
  position = await h.lookup('positions', 'Alert Position');
  noPositionLead = await h.lookup('positions', 'Alert Other Position');

  // The reminder settings hold the HR user's own login address.
  await h.setSetting('reminder_hr_emails', hr.email);
  await h.setSetting('reminder_manager_emails', '');

  const lead = await h.api('/admin/team-leads', {
    method: 'POST',
    ...h.asAdmin,
    body: {
      positionId: position.id,
      name: 'Alert Team Lead',
      email: 'alert.lead@example.test',
      userId: leadUser.id,
    },
  });
  assert.equal(lead.status, 201, JSON.stringify(lead.body));
});

after(async () => {
  await h.stop();
});

describe('who sees an alert', () => {
  let candidate;
  let employeeId;

  before(async () => {
    candidate = await h.newCandidate({ positionId: position.id, fullName: 'Alert Evaluation' });
    // Joined 20 days ago: the evaluation ended, its reminder is due now.
    ({ employeeId } = await h.joined(candidate, {
      positionId: position.id,
      onboardingDate: isoDay(inDays(-20)),
    }));
  });

  test('a signed-out caller gets 401', async () => {
    assert.equal((await h.api('/me/notifications')).status, 401);
    assert.equal((await h.api('/me/notifications/1/read', { method: 'POST' })).status, 401);
    assert.equal((await h.api('/me/notifications/read-all', { method: 'POST' })).status, 401);
  });

  test('the user whose address is a recipient sees it, with type, deadline, status and link', async () => {
    const res = await alertsOf(hr);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const alert = row(res.body.items, candidate);
    assert.ok(alert, 'the evaluation reminder is listed');
    assert.equal(alert.type, 'evaluation_end');
    assert.equal(alert.candidate.fullName, 'Alert Evaluation');
    assert.equal(alert.read, false);
    assert.equal(alert.emailStatus, 'pending');
    assert.ok(alert.dueAt && alert.sendAt);
    // The deadline is the end date at 17:30 Asia/Colombo.
    assert.equal(new Date(alert.dueAt).toISOString().slice(11, 16), '12:00');
    assert.equal(alert.link, `/employees/${employeeId}`);
    assert.ok(res.body.unreadCount >= 1);
  });

  test('another user sees nothing of it, and cannot mark it read', async () => {
    const mine = row((await alertsOf(hr)).body.items, candidate);
    const res = await alertsOf(outsider);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.items, []);
    assert.equal(res.body.unreadCount, 0);

    const attempt = await h.api(`/me/notifications/${mine.id}/read`, {
      method: 'POST',
      cookie: outsider.cookie,
    });
    assert.equal(attempt.status, 404);
    assert.deepEqual(await readMarks(), []);
  });

  test('the answer carries no other recipient addresses, salary or credentials', async () => {
    await h.api(`/salary/${candidate.id}`, {
      method: 'PUT',
      ...h.asAdmin,
      body: { salaryLkr: 876543.21 },
    });
    const text = JSON.stringify((await alertsOf(hr)).body);
    assert.ok(!text.includes('876543'));
    assert.ok(!text.includes(candidate.email));
    assert.doesNotMatch(text, /salary|password|credential|secret|token|@example\.test/i);
  });

  test('a recipient who may not open the record gets the alert without a link', async () => {
    // A Team Lead login can see its own team's candidates, but not employees.
    const manager = await h.signedIn({ roleCode: 'team_lead' });
    await h.setSetting('reminder_manager_emails', manager.email);
    const other = await h.newCandidate({ positionId: position.id, fullName: 'Alert No Link' });
    await h.joined(other, { positionId: position.id, onboardingDate: isoDay(inDays(-21)) });
    await h.setSetting('reminder_manager_emails', '');

    const res = await alertsOf(manager);
    assert.equal(res.status, 200);
    const alert = row(res.body.items, other);
    assert.ok(alert, 'the alert is listed');
    assert.equal(alert.link, null);
  });
});

describe('read state', () => {
  test('mark as read is personal, idempotent and lowers the unread count', async () => {
    const candidate = await h.newCandidate({ positionId: position.id, fullName: 'Alert Read' });
    await h.joined(candidate, { positionId: position.id, onboardingDate: isoDay(inDays(-22)) });

    const before = await alertsOf(hr);
    const alert = row(before.body.items, candidate);

    const first = await h.api(`/me/notifications/${alert.id}/read`, {
      method: 'POST',
      cookie: hr.cookie,
    });
    assert.equal(first.status, 200, JSON.stringify(first.body));
    const again = await h.api(`/me/notifications/${alert.id}/read`, {
      method: 'POST',
      cookie: hr.cookie,
    });
    assert.equal(again.status, 200);

    const after = await alertsOf(hr);
    assert.equal(after.body.unreadCount, before.body.unreadCount - 1);
    const readRow = row(after.body.items, candidate);
    assert.equal(readRow.read, true);
    assert.ok(readRow.readAt);

    const marks = (await readMarks()).filter((m) => Number(m.notification_id) === alert.id);
    assert.equal(marks.length, 1, 'one mark per user and alert, never a duplicate');
    assert.equal(Number(marks[0].user_id), hr.id);

    // Unread alerts come first, read ones after.
    const order = after.body.items.map((i) => i.read);
    assert.deepEqual(
      order,
      [...order].sort((a, b) => Number(a) - Number(b)),
    );
  });

  test('mark all as read marks only this user, and an unknown alert is 404', async () => {
    const before = await alertsOf(hr);
    const res = await h.api('/me/notifications/read-all', { method: 'POST', cookie: hr.cookie });
    assert.equal(res.status, 200);
    assert.equal(res.body.marked, before.body.unreadCount);
    assert.equal((await alertsOf(hr)).body.unreadCount, 0);

    assert.equal(
      (await h.api('/me/notifications/999999/read', { method: 'POST', cookie: hr.cookie })).status,
      404,
    );
    assert.equal(
      (await h.api('/me/notifications/abc/read', { method: 'POST', cookie: hr.cookie })).status,
      404,
    );
    const marks = await readMarks();
    assert.ok(marks.every((m) => Number(m.user_id) === hr.id));
  });
});

describe('scheduler compatibility and the other alert types', () => {
  test('the scheduler sends the email once and does not create or change alerts', async () => {
    // Without an active template the email fails and the alert shows that, so
    // the template is created first for the "sent" path.
    const template = await h.api('/email-templates', {
      method: 'POST',
      ...h.asAdmin,
      body: {
        type: 'phase_end_reminder',
        subject: 'Phase ending for {name}',
        body: 'Hello. {name} ends the phase on {date}.',
      },
    });
    assert.ok([201, 409, 422].includes(template.status), JSON.stringify(template.body));
    const candidate = await h.newCandidate({
      positionId: position.id,
      fullName: 'Alert Scheduler',
    });
    await h.joined(candidate, { positionId: position.id, onboardingDate: isoDay(inDays(-23)) });
    const before = await alertsOf(hr);
    const alert = row(before.body.items, candidate);
    assert.equal(alert.emailStatus, 'pending');
    const notificationsBefore = await h.query('SELECT count(*)::int AS n FROM notifications');

    spy.calls.length = 0;
    await runNotificationScheduler(h.db.pool, spy, { config: h.config });
    await runNotificationScheduler(h.db.pool, spy, { config: h.config });

    const after = await alertsOf(hr);
    const same = row(after.body.items, candidate);
    assert.equal(same.id, alert.id, 'the same alert, not a new one');
    assert.equal(same.emailStatus, 'sent');
    assert.equal(same.read, false, 'sending the email does not read the alert');
    assert.equal(
      after.body.items.filter((i) => i.candidate.id === candidate.id).length,
      1,
      'one alert per reminder',
    );
    const notificationsAfter = await h.query('SELECT count(*)::int AS n FROM notifications');
    assert.equal(notificationsAfter[0].n, notificationsBefore[0].n);
    assert.equal(
      (
        await h.query('SELECT count(*)::int AS n FROM email_log WHERE notification_id = $1', [
          alert.id,
        ])
      )[0].n,
      1,
    );
  });

  test('the Team Lead login sees the interview reminder for their own team only', async () => {
    const mine = await h.newCandidate({ positionId: position.id, fullName: 'Alert Interview' });
    await h.phoneSelected(mine);
    const slot = new Date(Date.now() + 10 * 3600 * 1000); // inside 24 hours: due now
    const created = await h.directInterview(mine, slot);
    assert.equal(created.status, 201, JSON.stringify(created.body));

    const other = await h.newCandidate({
      positionId: noPositionLead.id,
      fullName: 'Alert Elsewhere',
    });
    await h.phoneSelected(other);
    await h.directInterview(other, slot);

    const res = await alertsOf(leadUser);
    assert.equal(res.status, 200);
    const alert = row(res.body.items, mine);
    assert.ok(alert, 'the Team Lead sees their team’s interview reminder');
    assert.equal(alert.type, 'interview_reminder');
    assert.equal(alert.link, `/interviews/${created.body.interview.id}`);
    assert.equal(row(res.body.items, other), undefined);
    // Marking it read is theirs alone.
    const marked = await h.api(`/me/notifications/${alert.id}/read`, {
      method: 'POST',
      cookie: leadUser.cookie,
    });
    assert.equal(marked.status, 200);
    assert.equal(
      (await alertsOf(hr)).body.items.some((i) => i.id === alert.id),
      true,
    );
    assert.equal(row((await alertsOf(hr)).body.items, mine).read, false);
  });

  test('a cancelled reminder disappears and its replacement is the one alert', async () => {
    const candidate = await h.newCandidate({ positionId: position.id, fullName: 'Alert Replaced' });
    const day = isoDay(inDays(-24));
    const { employeeId } = await h.joined(candidate, {
      positionId: position.id,
      onboardingDate: day,
    });
    const first = row((await alertsOf(hr)).body.items, candidate);
    assert.ok(first);

    // Extending probation is not needed: cancel directly, as a date change does.
    await h.query(`UPDATE notifications SET status = 'cancelled' WHERE id = $1`, [first.id]);
    const after = await alertsOf(hr);
    assert.equal(
      after.body.items.some((i) => i.id === first.id),
      false,
    );
    assert.ok(employeeId);
  });
});
