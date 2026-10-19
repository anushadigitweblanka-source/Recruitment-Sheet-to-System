import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { createMailService } from '../src/modules/notifications/mailService.js';
import { sendMail } from '../src/modules/notifications/manualMail.js';
import { runNotificationScheduler } from '../src/modules/notifications/notifications.service.js';
import { isWeeklyReportDue, runWeeklyReport } from '../src/modules/notifications/weeklyReport.js';
import { auditActions, inDays, isoDay, startHarness } from './helpers/harness.js';

// Stage 11: notification timing, recipients, mail types and modes, the one-off
// mails, and the Monday weekly report. IMPLEMENTED_FROM_TASK_GUIDE.
//
// Every recipient is a made-up @example.test address. The mail adapter is a
// spy that records what would have been sent: nothing leaves the machine.

const HR = 'hr.sample@example.test';
const MANAGER = 'manager.sample@example.test';
const LEAD = 'lead.sample@example.test';

let h;
let position;
let positionNoLead;
let spy;

function makeSpy() {
  const calls = [];
  return {
    mode: 'test-spy',
    calls,
    send: async (mail) => {
      calls.push(mail);
      return { delivered: false, simulated: true };
    },
  };
}
const brokenMail = {
  mode: 'test-broken',
  send: async () => {
    throw new Error('simulated outage');
  },
};

const run = (mail = spy) => runNotificationScheduler(h.db.pool, mail, { config: h.config });
const notificationsFor = (candidateId, type) =>
  h.query(
    `SELECT * FROM notifications WHERE candidate_id = $1 ${type ? 'AND type = $2' : ''} ORDER BY id`,
    type ? [candidateId, type] : [candidateId],
  );
const logFor = (candidateId) =>
  h.query('SELECT * FROM email_log WHERE candidate_id = $1 ORDER BY id', [candidateId]);

async function template(type, extra = {}) {
  const res = await h.api('/email-templates', {
    method: 'POST',
    ...h.asAdmin,
    body: {
      type,
      subject: `${type} for {name}`,
      body: `Hello {name}. Position {position}. {date} {time} at {venue}. Lead {team_lead}.`,
      ...extra,
    },
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.template;
}

before(async () => {
  h = await startHarness();
  spy = makeSpy();
  position = await h.lookup('positions', 'Sample Position');
  positionNoLead = await h.lookup('positions', 'Sample Position Without Lead');
  const lead = await h.api('/admin/team-leads', {
    method: 'POST',
    ...h.asAdmin,
    body: { positionId: position.id, name: 'Sample Team Lead', email: LEAD },
  });
  assert.equal(lead.status, 201);

  await h.setSetting('reminder_hr_emails', HR);
  await h.setSetting('reminder_manager_emails', MANAGER);
  await h.setSetting('interview_venue', 'Sample Office, Floor 2');

  for (const type of [
    'phase_end_reminder',
    'interview_reminder',
    'joining_reminder',
    'cv_pending_reminder',
  ]) {
    await template(type);
  }
});

after(async () => {
  await h.stop();
});

describe('phase reminders', () => {
  test('a phase row creates a pending reminder: deadline 17:30 Colombo, sent 24 hours earlier', async () => {
    const candidate = await h.newCandidate({ positionId: position.id });
    const { employeeId } = await h.joined(candidate, { positionId: position.id });

    const phases = await h.api(`/employees/${employeeId}`, h.asAdmin);
    const end = phases.body.phases[0].endDate;
    const [note] = await notificationsFor(candidate.id, 'evaluation_end');

    assert.equal(note.due_at.toISOString(), `${end}T12:00:00.000Z`); // 17:30 +05:30
    assert.equal(note.send_at.getTime(), note.due_at.getTime() - 24 * 3600 * 1000);
    assert.deepEqual(note.recipients, [HR, MANAGER]);
    assert.equal(note.status, 'pending');
    assert.equal(note.sent_at, null);
  });

  test('a reminder whose time has passed is sent on the next run, logged once and never again', async () => {
    // Joined 20 days ago: the evaluation ended long ago, so send_at has passed.
    const candidate = await h.newCandidate({ positionId: position.id });
    await h.joined(candidate, {
      positionId: position.id,
      onboardingDate: isoDay(inDays(-20)),
    });
    spy.calls.length = 0;

    const first = await run();
    assert.ok(first.sent >= 1);
    const [note] = await notificationsFor(candidate.id, 'evaluation_end');
    assert.equal(note.status, 'sent');
    assert.notEqual(note.sent_at, null);

    const logs = await logFor(candidate.id);
    assert.equal(logs.length, 1);
    assert.equal(logs[0].status, 'sent');
    assert.deepEqual(logs[0].to_addresses, [HR, MANAGER]);
    assert.equal(logs[0].is_resend, false);
    assert.match(logs[0].subject_sent, /phase_end_reminder for Stage Eleven Sample/);
    assert.ok(spy.calls.some((call) => call.to.includes(HR)));

    const second = await run();
    assert.equal(second.sent, 0);
    assert.equal((await logFor(candidate.id)).length, 1);
    assert.ok((await auditActions(h, 'email_log', Number(logs[0].id))).includes('EMAIL_SEND'));
  });

  test('the candidate is added to the evaluation reminder only when Settings says so', async () => {
    await h.setSetting('evaluation_reminder_include_candidate', 'true');
    try {
      const candidate = await h.newCandidate({ positionId: position.id });
      await h.joined(candidate, { positionId: position.id });
      const [note] = await notificationsFor(candidate.id, 'evaluation_end');
      assert.ok(note.recipients.includes(candidate.email));
      assert.ok(note.recipients.includes(HR));
    } finally {
      await h.setSetting('evaluation_reminder_include_candidate', 'false');
    }
  });

  test('a probation extension cancels the pending reminder and creates a replacement', async () => {
    const candidate = await h.newCandidate({ positionId: position.id });
    const { employeeId } = await h.joined(candidate, {
      positionId: position.id,
      onboardingDate: isoDay(inDays(-5)),
    });
    await run(); // the evaluation reminder is long due; send it
    const passed = await h.api(`/employees/${employeeId}/decision`, {
      method: 'POST',
      ...h.asAdmin,
      body: { result: 'pass' },
    });
    assert.equal(passed.status, 200, JSON.stringify(passed.body));

    const [probation] = await notificationsFor(candidate.id, 'probation_end');
    assert.equal(probation.status, 'pending');
    assert.deepEqual(probation.recipients, [HR, MANAGER]);

    const probationRow = passed.body.phases.find((p) => p.phase === 'probation');
    const extendTo = new Date(`${probationRow.endDate}T00:00:00Z`);
    extendTo.setUTCDate(extendTo.getUTCDate() + 20);
    const extended = await h.api(`/employees/${employeeId}/decision`, {
      method: 'POST',
      ...h.asAdmin,
      body: { result: 'extend', endDate: isoDay(extendTo) },
    });
    assert.equal(extended.status, 200, JSON.stringify(extended.body));

    const all = await notificationsFor(candidate.id, 'probation_end');
    assert.equal(all.length, 2);
    assert.equal(all[0].status, 'cancelled');
    assert.equal(all[1].status, 'pending');
    assert.equal(all[1].due_at.toISOString(), `${isoDay(extendTo)}T12:00:00.000Z`);
    assert.notEqual(all[1].phase_history_id, all[0].phase_history_id);
    assert.ok(
      (await auditActions(h, 'notifications', Number(all[0].id))).includes('NOTIFICATION_CANCEL'),
    );
  });

  test('discontinuing an employee cancels the reminders still waiting', async () => {
    const candidate = await h.newCandidate({ positionId: position.id });
    const { employeeId } = await h.joined(candidate, { positionId: position.id });
    const left = await h.api(`/employees/${employeeId}/decision`, {
      method: 'POST',
      ...h.asAdmin,
      body: { result: 'discontinue', reason: 'Sample reason', exitDate: isoDay(inDays(12)) },
    });
    assert.equal(left.status, 200, JSON.stringify(left.body));
    const rows = await notificationsFor(candidate.id);
    assert.ok(rows.length > 0);
    assert.ok(rows.every((row) => row.status === 'cancelled'));
  });

  test('no reminder is created, and the reason is kept, when nobody is configured to receive it', async () => {
    await h.setSetting('reminder_hr_emails', '');
    await h.setSetting('reminder_manager_emails', '');
    try {
      const candidate = await h.newCandidate({ positionId: position.id });
      await h.joined(candidate, { positionId: position.id });
      const [note] = await notificationsFor(candidate.id, 'evaluation_end');
      assert.equal(note.status, 'failed');
      assert.match(note.last_error, /missing/i);
      assert.deepEqual(note.recipients, []);
      assert.deepEqual(await auditActions(h, 'notifications', Number(note.id)), [
        'NOTIFICATION_BLOCKED',
      ]);
      // A blocked reminder is never sent.
      spy.calls.length = 0;
      await run();
      assert.equal((await logFor(candidate.id)).length, 0);
    } finally {
      await h.setSetting('reminder_hr_emails', HR);
      await h.setSetting('reminder_manager_emails', MANAGER);
    }
  });
});

describe('interview and joining reminders', () => {
  test('the interview reminder goes 24 hours before to the candidate and Team Lead, HR copied', async () => {
    const candidate = await h.newCandidate({ positionId: position.id });
    await h.phoneSelected(candidate);
    const slot = inDays(5);
    const created = await h.directInterview(candidate, slot);
    assert.equal(created.status, 201, JSON.stringify(created.body));

    const [note] = await notificationsFor(candidate.id, 'interview_reminder');
    assert.equal(note.due_at.getTime(), slot.getTime());
    assert.equal(note.send_at.getTime(), slot.getTime() - 24 * 3600 * 1000);
    assert.deepEqual([...note.recipients].sort(), [candidate.email, LEAD].sort());
    assert.deepEqual(note.cc_recipients, [HR]);
    assert.equal(note.status, 'pending');

    // Not yet due: the run leaves it alone.
    await run();
    assert.equal((await notificationsFor(candidate.id, 'interview_reminder'))[0].status, 'pending');
  });

  test('a changed interview time replaces the reminders', async () => {
    const candidate = await h.newCandidate({ positionId: position.id });
    await h.phoneSelected(candidate);
    const created = await h.directInterview(candidate, inDays(4));
    const id = created.body.interview.id;

    const moved = inDays(6);
    const res = await h.api(`/interviews/${id}`, {
      method: 'PATCH',
      ...h.asAdmin,
      body: { scheduledAt: moved.toISOString() },
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));

    const rows = await notificationsFor(candidate.id, 'interview_reminder');
    assert.equal(rows.length, 2);
    assert.equal(rows[0].status, 'cancelled');
    assert.equal(rows[1].status, 'pending');
    assert.equal(rows[1].due_at.getTime(), moved.getTime());
  });

  test('a missing Team Lead or candidate email blocks the reminder with the reason', async () => {
    const noLead = await h.newCandidate({ positionId: positionNoLead.id });
    await h.phoneSelected(noLead);
    await h.directInterview(noLead, inDays(4));
    const [note] = await notificationsFor(noLead.id, 'interview_reminder');
    assert.equal(note.status, 'failed');
    assert.match(note.last_error, /team lead/i);

    const noEmail = await h.newCandidate({ positionId: position.id, email: null });
    await h.phoneSelected(noEmail);
    await h.directInterview(noEmail, inDays(4));
    const [other] = await notificationsFor(noEmail.id, 'interview_reminder');
    assert.equal(other.status, 'failed');
    assert.match(other.last_error, /candidate email/);
  });

  test('the reminder mail is filled with name, position, date, time, venue and Team Lead', async () => {
    const candidate = await h.newCandidate({ positionId: position.id });
    await h.phoneSelected(candidate);
    // An interview tomorrow morning: its reminder is due now.
    const slot = new Date(Date.now() + 20 * 3600 * 1000);
    await h.directInterview(candidate, slot);
    spy.calls.length = 0;

    await run();

    const call = spy.calls.find((c) => c.to.includes(candidate.email));
    assert.ok(call, 'a mail was handed to the adapter');
    assert.deepEqual(call.cc, [HR]);
    assert.match(call.body, /Hello Stage Eleven Sample/);
    assert.match(call.body, /Sample Position/);
    assert.match(call.body, /Sample Office, Floor 2/);
    assert.match(call.body, /Lead Sample Team Lead/);
    assert.doesNotMatch(call.body, /\{[a-z_]+\}/);

    const [log] = (await logFor(candidate.id)).filter((row) => row.cc_addresses);
    assert.deepEqual(log.cc_addresses, [HR]);
  });

  test('the joining reminder is created from the joining date and replaced when it changes', async () => {
    const candidate = await h.newCandidate({ positionId: position.id });
    const day = isoDay(inDays(12));
    const offer = await h.offered(candidate, { positionId: position.id, onboardingDate: day });

    const [note] = await notificationsFor(candidate.id, 'joining_reminder');
    assert.equal(note.due_at.toISOString(), new Date(`${day}T00:00:00+05:30`).toISOString());
    assert.equal(note.send_at.getTime(), note.due_at.getTime() - 24 * 3600 * 1000);
    assert.deepEqual(note.recipients, [candidate.email]);
    assert.deepEqual(note.cc_recipients, [HR]);

    const newDay = isoDay(inDays(14));
    const changed = await h.api(`/offers/${offer.id}`, {
      method: 'PATCH',
      ...h.asAdmin,
      body: { onboardingDate: newDay },
    });
    assert.equal(changed.status, 200, JSON.stringify(changed.body));
    const rows = await notificationsFor(candidate.id, 'joining_reminder');
    assert.deepEqual(
      rows.map((row) => row.status),
      ['cancelled', 'pending'],
    );
  });

  test('an interview already in the past gets no reminder', async () => {
    const candidate = await h.newCandidate({ positionId: position.id });
    await h.phoneSelected(candidate);
    await h.directInterview(candidate, inDays(-1));
    assert.deepEqual(await notificationsFor(candidate.id, 'interview_reminder'), []);
  });
});

describe('failures are logged', () => {
  test('a delivery failure marks the reminder and the log row failed and audits it', async () => {
    const candidate = await h.newCandidate({ positionId: position.id });
    await h.joined(candidate, { positionId: position.id, onboardingDate: isoDay(inDays(-20)) });

    await run(brokenMail);

    const [note] = await notificationsFor(candidate.id, 'evaluation_end');
    assert.equal(note.status, 'failed');
    assert.match(note.last_error, /simulated outage/);
    const [log] = await logFor(candidate.id);
    assert.equal(log.status, 'failed');
    assert.match(log.error, /simulated outage/);
    assert.ok(
      (await auditActions(h, 'notifications', Number(note.id))).includes('EMAIL_SEND_FAILED'),
    );
  });
});

describe('mail types and send modes', () => {
  test('only the guide’s mail types can be created', async () => {
    const res = await h.api('/email-templates', {
      method: 'POST',
      ...h.asAdmin,
      body: { type: 'invented_type', subject: 's', body: 'b' },
    });
    assert.equal(res.status, 422);
    assert.match(res.body.fields.type, /must be one of/);
    assert.match(res.body.fields.type, /interview_invitation/);
    assert.match(res.body.fields.type, /status_rejected_on_hold/);
  });

  test('each type allows only the modes the guide gives it', async () => {
    const make = (type, sendMode) =>
      h.api('/email-templates', {
        method: 'POST',
        ...h.asAdmin,
        body: {
          type,
          subject: `${type} for {name}`,
          body: 'Hello {name}. Position {position}. {date} {time} at {venue}. Lead {team_lead}.',
          sendMode,
        },
      });

    // Joining mail: One-click only.
    assert.equal((await make('joining_onboarding', 'auto')).status, 422);
    const joining = await make('joining_onboarding', 'one_click');
    assert.equal(joining.status, 201);

    // Reminders: Auto only (the existing reminder templates already default to it).
    const reminder = (await h.api('/email-templates', h.asAdmin)).body.items.find(
      (t) => t.type === 'interview_reminder',
    );
    assert.equal(reminder.sendMode, 'auto');
    const wrong = await h.api(`/email-templates/${reminder.id}`, {
      method: 'PATCH',
      ...h.asAdmin,
      body: { sendMode: 'one_click' },
    });
    assert.equal(wrong.status, 422);

    // Rejected / On Hold: One-click.
    assert.equal((await make('status_rejected_on_hold', 'auto')).status, 422);
    assert.equal((await make('status_rejected_on_hold', 'one_click')).status, 201);

    // Invitation and Team Lead summary: Auto or One-click, configurable.
    assert.equal((await make('interview_invitation', 'auto')).status, 201);
    assert.equal((await make('team_lead_summary', 'one_click')).status, 201);
    const invitation = (await h.api('/email-templates', h.asAdmin)).body.items.find(
      (t) => t.type === 'interview_invitation',
    );
    const toOneClick = await h.api(`/email-templates/${invitation.id}`, {
      method: 'PATCH',
      ...h.asAdmin,
      body: { sendMode: 'one_click' },
    });
    assert.equal(toOneClick.status, 200);
    assert.equal(toOneClick.body.template.sendMode, 'one_click');
  });
});

describe('one-off mails', () => {
  let candidate;

  before(async () => {
    candidate = await h.newCandidate({ positionId: position.id, fullName: 'Mail Sample' });
    await h.phoneSelected(candidate, inDays(4));
  });

  test('a preview shows the filled mail and what is missing, and sends nothing', async () => {
    spy.calls.length = 0;
    const res = await h.api(`/candidates/${candidate.id}/emails/preview`, {
      method: 'POST',
      ...h.asAdmin,
      body: { type: 'interview_invitation' },
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(res.body.to, [candidate.email]);
    assert.equal(res.body.canSend, true);
    assert.match(res.body.subject, /interview_invitation for Mail Sample/);
    assert.match(res.body.body, /Sample Office, Floor 2/);
    assert.deepEqual(spy.calls, []);
    assert.deepEqual(await logFor(candidate.id), []);
  });

  test('one click sends, logs and marks the Company CV as sent; a second send is refused', async () => {
    await h.setSetting('company_cv_template_url', 'https://example.test/company-cv-template');
    const invitation = (await h.api('/email-templates', h.asAdmin)).body.items.find(
      (t) => t.type === 'interview_invitation',
    );
    await h.api(`/email-templates/${invitation.id}`, {
      method: 'PATCH',
      ...h.asAdmin,
      body: {
        body: 'Hello {name}. Template: {company_cv_template}. Upload: {company_cv_upload_link}.',
      },
    });

    const res = await h.api(`/candidates/${candidate.id}/emails/send`, {
      method: 'POST',
      ...h.asAdmin,
      body: { type: 'interview_invitation' },
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.delivered, true);

    const [log] = await logFor(candidate.id);
    assert.equal(log.status, 'sent');
    assert.equal(log.is_resend, false);
    assert.equal(Number(log.sent_by), h.admin.id);
    assert.match(log.body_sent, /https:\/\/example\.test\/company-cv-template/);
    assert.match(log.body_sent, /company-cv\/upload\/[A-Za-z0-9_-]{20,}/);

    const after = await h.api(`/candidates/${candidate.id}`, h.asAdmin);
    assert.equal(after.body.candidate.companyCvStatus, 'sent');
    assert.equal(after.body.candidate.companyCvPending, true);

    const again = await h.api(`/candidates/${candidate.id}/emails/send`, {
      method: 'POST',
      ...h.asAdmin,
      body: { type: 'interview_invitation' },
    });
    assert.equal(again.status, 422);
    assert.match(again.body.fields.mail, /Resend/);
    assert.equal((await logFor(candidate.id)).length, 1);
  });

  test('a resend is allowed and logged separately', async () => {
    const res = await h.api(`/candidates/${candidate.id}/emails/send`, {
      method: 'POST',
      ...h.asAdmin,
      body: { type: 'interview_invitation', resend: true },
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const logs = await logFor(candidate.id);
    assert.equal(logs.length, 2);
    assert.equal(logs[1].is_resend, true);
    assert.equal(logs[0].is_resend, false);
    assert.ok((await auditActions(h, 'email_log', Number(logs[1].id))).includes('EMAIL_RESEND'));
  });

  test('a resend of a mail that was never sent is refused', async () => {
    const fresh = await h.newCandidate({ positionId: position.id });
    await h.phoneSelected(fresh, inDays(4));
    const res = await h.api(`/candidates/${fresh.id}/emails/send`, {
      method: 'POST',
      ...h.asAdmin,
      body: { type: 'interview_invitation', resend: true },
    });
    assert.equal(res.status, 422);
  });

  test('HR may edit one mail before sending; the edited text is what is logged', async () => {
    const fresh = await h.newCandidate({ positionId: position.id, fullName: 'Edited Mail Sample' });
    await h.phoneSelected(fresh, inDays(4));
    const res = await h.api(`/candidates/${fresh.id}/emails/send`, {
      method: 'POST',
      ...h.asAdmin,
      body: {
        type: 'interview_invitation',
        subject: 'Edited subject for this one',
        body: 'Edited body. {salary} is never filled in.',
      },
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const [log] = await logFor(fresh.id);
    assert.equal(log.subject_sent, 'Edited subject for this one');
    // A salary placeholder is not a placeholder: it is left as plain text.
    assert.equal(log.body_sent, 'Edited body. {salary} is never filled in.');
  });

  test('a mail is blocked when the address, date or Team Lead is missing', async () => {
    const noEmail = await h.newCandidate({ positionId: position.id, email: null });
    await h.phoneSelected(noEmail, inDays(4));
    const a = await h.api(`/candidates/${noEmail.id}/emails/send`, {
      method: 'POST',
      ...h.asAdmin,
      body: { type: 'interview_invitation' },
    });
    assert.equal(a.status, 422);
    assert.match(a.body.fields.mail, /candidate email/);

    const noDate = await h.newCandidate({ positionId: position.id });
    const b = await h.api(`/candidates/${noDate.id}/emails/send`, {
      method: 'POST',
      ...h.asAdmin,
      body: { type: 'interview_invitation' },
    });
    assert.equal(b.status, 422);
    assert.match(b.body.fields.mail, /interview date and time/);

    const noLead = await h.newCandidate({ positionId: positionNoLead.id });
    await h.phoneSelected(noLead, inDays(4));
    const c = await h.api(`/candidates/${noLead.id}/emails/send`, {
      method: 'POST',
      ...h.asAdmin,
      body: { type: 'team_lead_summary' },
    });
    assert.equal(c.status, 422);
    assert.match(c.body.fields.mail, /team lead/);

    for (const who of [noEmail, noDate, noLead]) assert.deepEqual(await logFor(who.id), []);
  });

  test('the Team Lead summary goes to the Team Lead', async () => {
    const res = await h.api(`/candidates/${candidate.id}/emails/send`, {
      method: 'POST',
      ...h.asAdmin,
      body: { type: 'team_lead_summary' },
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.deepEqual(res.body.to, [LEAD]);
  });

  test('the reminder types cannot be sent by hand', async () => {
    const res = await h.api(`/candidates/${candidate.id}/emails/send`, {
      method: 'POST',
      ...h.asAdmin,
      body: { type: 'interview_reminder' },
    });
    assert.equal(res.status, 422);
  });

  test('a mail type set to Auto goes out by itself when the interview slot is given', async () => {
    // interview_invitation is currently One-click; switch it to Auto.
    const invitation = (await h.api('/email-templates', h.asAdmin)).body.items.find(
      (t) => t.type === 'interview_invitation',
    );
    await h.api(`/email-templates/${invitation.id}`, {
      method: 'PATCH',
      ...h.asAdmin,
      body: { sendMode: 'auto' },
    });

    const auto = await h.newCandidate({ positionId: position.id, fullName: 'Auto Mail Sample' });
    await h.phoneSelected(auto, inDays(4));
    let logs = await logFor(auto.id);
    assert.equal(logs.length, 1, 'the invitation was sent automatically');
    assert.deepEqual(logs[0].to_addresses, [auto.email]);
    assert.equal(logs[0].sent_by, null);

    // The Team Lead summary is One-click, so it was not sent on its own.
    const row = await h.query(
      `SELECT t.type FROM email_log l JOIN email_templates t ON t.id = l.template_id
        WHERE l.candidate_id = $1`,
      [auto.id],
    );
    assert.deepEqual(
      row.map((r) => r.type),
      ['interview_invitation'],
    );

    // Editing the phone interview does not send it a second time.
    const screen = (
      await h.query('SELECT id FROM phone_screens WHERE candidate_id = $1', [auto.id])
    )[0];
    await h.api(`/phone-interviews/${screen.id}`, {
      method: 'PATCH',
      ...h.asAdmin,
      body: { review: 'Edited remark' },
    });
    logs = await logFor(auto.id);
    assert.equal(logs.length, 1);
  });
});

describe('the Monday weekly report', () => {
  // 2026-10-19 is a Monday.
  const MONDAY_0800 = new Date('2026-10-19T08:00:00+05:30');
  const MONDAY_0759 = new Date('2026-10-19T07:59:00+05:30');
  const SUNDAY = new Date('2026-10-18T09:00:00+05:30');

  test('is due only on Monday from 08:00 Asia/Colombo', () => {
    assert.equal(isWeeklyReportDue(MONDAY_0800), true);
    assert.equal(isWeeklyReportDue(new Date('2026-10-19T15:30:00+05:30')), true);
    assert.equal(isWeeklyReportDue(MONDAY_0759), false);
    assert.equal(isWeeklyReportDue(SUNDAY), false);
    assert.equal(isWeeklyReportDue(new Date('2026-10-20T08:00:00+05:30')), false);
  });

  test('sends nothing without recipients, and says why', async () => {
    const result = await runWeeklyReport(h.db.pool, spy, { now: MONDAY_0800 });
    assert.equal(result.status, 'no_recipients');
  });

  test('sends the previous Monday-to-Sunday week once, with counts only', async () => {
    await h.setSetting('weekly_report_recipients', `${HR}, ${MANAGER}`);
    spy.calls.length = 0;

    assert.equal((await runWeeklyReport(h.db.pool, spy, { now: SUNDAY })).status, 'not_due');
    assert.equal((await runWeeklyReport(h.db.pool, spy, { now: MONDAY_0759 })).status, 'not_due');

    const sent = await runWeeklyReport(h.db.pool, spy, { now: MONDAY_0800 });
    assert.equal(sent.status, 'sent');
    assert.equal(sent.weekStart, '2026-10-12');
    assert.equal(spy.calls.length, 1);
    assert.deepEqual(spy.calls[0].to, [HR, MANAGER]);
    assert.match(spy.calls[0].subject, /2026-10-12 to 2026-10-18/);
    assert.doesNotMatch(spy.calls[0].body, /Stage Eleven Sample|Mail Sample|@example/);

    // Running again the same Monday, or the job on every 15-minute tick,
    // never sends it twice.
    const again = await runWeeklyReport(h.db.pool, spy, {
      now: new Date('2026-10-19T08:15:00+05:30'),
    });
    assert.equal(again.status, 'already_sent');
    assert.equal(spy.calls.length, 1);

    const runs = await h.query('SELECT * FROM weekly_report_runs');
    assert.equal(runs.length, 1);
    assert.equal(runs[0].status, 'sent');
    assert.ok(
      (await h.query(`SELECT 1 FROM audit_log WHERE action = 'WEEKLY_REPORT_SEND'`)).length > 0,
    );
  });

  test('a failed send is logged and retried on the next run, then sent once', async () => {
    const nextMonday = new Date('2026-10-26T08:00:00+05:30');
    const failed = await runWeeklyReport(h.db.pool, brokenMail, { now: nextMonday });
    assert.equal(failed.status, 'failed');
    const [row] = await h.query(`SELECT * FROM weekly_report_runs WHERE week_start = '2026-10-19'`);
    assert.equal(row.status, 'failed');
    assert.match(row.error, /simulated outage/);

    const retry = await runWeeklyReport(h.db.pool, spy, {
      now: new Date('2026-10-26T08:15:00+05:30'),
    });
    assert.equal(retry.status, 'sent');
    const [after] = await h.query(
      `SELECT * FROM weekly_report_runs WHERE week_start = '2026-10-19'`,
    );
    assert.equal(after.status, 'sent');
    assert.equal(Number(after.attempts), 2);
  });

  test('the recipients are an editable setting, not fixed in code', async () => {
    const bad = await h.api('/admin/settings/weekly_report_recipients', {
      method: 'PATCH',
      ...h.asAdmin,
      body: { value: 'not-an-address' },
    });
    assert.equal(bad.status, 422);
    const ok = await h.api('/admin/settings/weekly_report_recipients', {
      method: 'PATCH',
      ...h.asAdmin,
      body: { value: ' Main.User@Example.test ' },
    });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.setting.value, 'main.user@example.test');
  });
});

describe('the development mail adapter', () => {
  test('delivers nothing anywhere and says so', async () => {
    const mail = createMailService();
    assert.equal(mail.mode, 'development');
    const result = await mail.send({ to: [HR], cc: [MANAGER], subject: 'Sample' });
    assert.equal(result.delivered, false);
    assert.equal(result.simulated, true);
  });
});

describe('sending from the candidate page is honest about delivery', () => {
  let person;
  const post = (path, body) =>
    h.api(`/candidates/${person.id}/emails/${path}`, { method: 'POST', ...h.asAdmin, body });

  before(async () => {
    // One-click, so that choosing an interview slot does not send the mail by itself.
    const invitation = (await h.api('/email-templates', h.asAdmin)).body.items.find(
      (t) => t.type === 'interview_invitation',
    );
    await h.api(`/email-templates/${invitation.id}`, {
      method: 'PATCH',
      ...h.asAdmin,
      body: { sendMode: 'one_click' },
    });
    person = await h.newCandidate({ positionId: position.id, fullName: 'Honest Mail Sample' });
    await h.phoneSelected(person, inDays(5));
  });

  test('the preview and the send both say the adapter is the development one', async () => {
    const preview = await post('preview', { type: 'interview_invitation' });
    assert.equal(preview.body.deliveryMode, 'development');
    assert.equal(preview.body.canSend, true);

    const sent = await post('send', { type: 'interview_invitation' });
    assert.equal(sent.status, 201, JSON.stringify(sent.body));
    assert.equal(sent.body.deliveryMode, 'development');
    assert.equal(sent.body.simulated, true);
    assert.equal((await logFor(person.id)).length, 1);
  });

  test('Mail Status on the phone interview follows the email log, not a typed value', async () => {
    const status = async (candidate) =>
      (await h.api(`/candidates/${candidate.id}/phone-interview`, h.asAdmin)).body.candidate
        .mailStatus;
    const fresh = await h.newCandidate({ positionId: position.id, fullName: 'Status Sample' });
    await h.phoneSelected(fresh, inDays(7));
    assert.equal(await status(fresh), null, 'nothing prepared yet');

    await sendMail(
      h.db.pool,
      null,
      { candidateId: fresh.id, type: 'interview_invitation' },
      brokenMail,
      {
        config: h.config,
      },
    );
    assert.equal(await status(fresh), 'failed');
    await sendMail(h.db.pool, null, { candidateId: fresh.id, type: 'interview_invitation' }, spy, {
      config: h.config,
    });
    assert.equal(await status(fresh), 'sent');
    const list = (await h.api('/phone-interviews?search=Status%20Sample', h.asAdmin)).body.items;
    assert.equal(list[0].candidate.mailStatus, 'sent');
  });

  test('a development-mode send reads Simulated, never Sent, and is read-only', async () => {
    const fresh = await h.newCandidate({ positionId: position.id, fullName: 'Simulated Sample' });
    await h.phoneSelected(fresh, inDays(8));
    const sent = await sendMail(
      h.db.pool,
      null,
      { candidateId: fresh.id, type: 'interview_invitation' },
      createMailService(),
      { config: h.config },
    );
    assert.equal(sent.data.simulated, true);

    const view = async () =>
      (await h.api(`/candidates/${fresh.id}/phone-interview`, h.asAdmin)).body;
    assert.equal((await view()).candidate.mailStatus, 'simulated');
    const [row] = await h.query('SELECT status, error FROM email_log WHERE candidate_id = $1', [
      fresh.id,
    ]);
    assert.equal(row.status, 'sent', 'the status column only allows queued, sent, failed');
    assert.match(row.error, /^SIMULATED:/);

    // HR cannot type a status: a request carrying one changes nothing.
    const screen = (await view()).phoneScreen;
    await h.api(`/phone-interviews/${screen.id}`, {
      method: 'PATCH',
      ...h.asAdmin,
      body: { mailStatus: 'sent' },
    });
    assert.equal((await view()).candidate.mailStatus, 'simulated');
  });

  test('a candidate without an interview time is refused and nothing is logged', async () => {
    const other = await h.newCandidate({ positionId: position.id, fullName: 'No Slot Sample' });
    const path = `/candidates/${other.id}/emails`;
    const preview = await h.api(`${path}/preview`, {
      method: 'POST',
      ...h.asAdmin,
      body: { type: 'interview_invitation' },
    });
    assert.equal(preview.body.canSend, false);
    assert.deepEqual(preview.body.missing, ['interview date and time']);

    const send = await h.api(`${path}/send`, {
      method: 'POST',
      ...h.asAdmin,
      body: { type: 'interview_invitation' },
    });
    assert.equal(send.status, 422);
    assert.deepEqual(await logFor(other.id), []);
  });

  test('a delivery failure is logged as failed, never as sent, and can be retried', async () => {
    const other = await h.newCandidate({ positionId: position.id, fullName: 'Failing Sample' });
    await h.phoneSelected(other, inDays(6));
    const failed = await sendMail(
      h.db.pool,
      null,
      { candidateId: other.id, type: 'interview_invitation' },
      brokenMail,
      { config: h.config },
    );
    assert.equal(failed.data.delivered, false);
    const [row] = await logFor(other.id);
    assert.equal(row.status, 'failed');
    assert.equal(row.sent_at, null);
    assert.match(row.error, /simulated outage/);

    // A failed attempt does not block a proper retry, and nothing is duplicated.
    const retry = await sendMail(
      h.db.pool,
      null,
      { candidateId: other.id, type: 'interview_invitation' },
      spy,
      { config: h.config },
    );
    assert.equal(retry.data.delivered, true);
    assert.deepEqual(
      (await logFor(other.id)).map((r) => r.status),
      ['failed', 'sent'],
    );
  });
});
