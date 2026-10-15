import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { auditActions, inDays, isoDay, startHarness } from './helpers/harness.js';

// Stage 11 final review: the Main User approves offer mails (the joining /
// onboarding mail), and the Auto / Review-then-send choice. All names,
// addresses and amounts are made up; the mail adapter is a spy.

const SALARY = 765432;

let h;
let hr;
let teamLead;
let intern;
let position;

// The application's own development adapter delivers nothing; the email log
// is the evidence of what was sent.
const logOf = (candidateId) =>
  h.query('SELECT * FROM email_log WHERE candidate_id = $1 ORDER BY id', [candidateId]);

async function candidateWithOffer(fullName) {
  const candidate = await h.newCandidate({ positionId: position.id, fullName });
  await h.offered(candidate, { positionId: position.id, onboardingDate: isoDay(inDays(10)) });
  return candidate;
}
const prepare = (candidate, who, extra = {}) =>
  h.api(`/candidates/${candidate.id}/emails/send`, {
    method: 'POST',
    cookie: who.cookie,
    body: { type: 'joining_onboarding', ...extra },
  });

before(async () => {
  h = await startHarness();
  hr = await h.signedIn({ roleCode: 'hr' });
  teamLead = await h.signedIn({ roleCode: 'team_lead' });
  intern = await h.signedIn({ roleCode: 'intern_dev' });
  position = await h.lookup('positions', 'Sample Position');
  const res = await h.api('/email-templates', {
    method: 'POST',
    ...h.asAdmin,
    body: {
      type: 'joining_onboarding',
      subject: 'Welcome {name}',
      body: 'Welcome {name}, you join on {date} as {position}.',
    },
  });
  assert.equal(res.status, 201);
});

after(async () => {
  await h.stop();
});

describe('Main User approval of the offer mail', () => {
  test('HR prepares it: nothing is delivered, it waits, and it is audited', async () => {
    const candidate = await candidateWithOffer('Approval Sample One');
    const res = await prepare(candidate, hr);

    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.pendingApproval, true);
    assert.equal(res.body.delivered, false);

    const [row] = await logOf(candidate.id);
    assert.equal(row.status, 'queued');
    assert.equal(row.sent_at, null);
    assert.equal(Number(row.sent_by), hr.id);
    assert.deepEqual(await auditActions(h, 'email_log', Number(row.id)), ['EMAIL_PREPARE']);

    // Nothing reaches the candidate: the status stays Candidate-unmailed.
    const waiting = await h.api('/email-approvals', { cookie: hr.cookie });
    assert.equal(waiting.status, 200);
    assert.ok(waiting.body.items.some((item) => item.id === Number(row.id)));
  });

  test('a second prepare while one is waiting is refused', async () => {
    const candidate = await candidateWithOffer('Approval Sample Two');
    assert.equal((await prepare(candidate, hr)).status, 201);
    const again = await prepare(candidate, hr);
    assert.equal(again.status, 422);
    assert.match(again.body.fields.mail, /waiting for the Main User/);
    assert.equal((await logOf(candidate.id)).length, 1);
  });

  test('only the Main User can approve or reject; HR, Team Lead and Intern are refused', async () => {
    const candidate = await candidateWithOffer('Approval Sample Three');
    const prepared = await prepare(candidate, hr);
    const id = prepared.body.logId;

    for (const who of [hr, teamLead, intern]) {
      for (const action of ['approve', 'reject']) {
        const res = await h.api(`/email-log/${id}/${action}`, {
          method: 'POST',
          cookie: who.cookie,
          body: {},
        });
        assert.equal(res.status, 403, `${who.email} ${action}`);
      }
    }
    assert.equal((await h.api(`/email-log/${id}/approve`, { method: 'POST' })).status, 401);
    // The mail is untouched by every refused attempt.
    assert.equal((await logOf(candidate.id))[0].status, 'queued');
  });

  test('the Main User approves: it is sent, logged as sent, and the approval is audited', async () => {
    const candidate = await candidateWithOffer('Approval Sample Four');
    const id = (await prepare(candidate, hr)).body.logId;

    const res = await h.api(`/email-log/${id}/approve`, {
      method: 'POST',
      ...h.asAdmin,
      body: {},
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.delivered, true);

    const [row] = await logOf(candidate.id);
    assert.equal(row.status, 'sent');
    assert.notEqual(row.sent_at, null);
    // The preparer stays on the row; the approver is in the audit trail.
    assert.equal(Number(row.sent_by), hr.id);
    const audit = await h.query(
      `SELECT actor_user_id, action FROM audit_log WHERE entity_type = 'email_log' AND entity_id = $1 ORDER BY id`,
      [Number(row.id)],
    );
    assert.deepEqual(
      audit.map((a) => a.action),
      ['EMAIL_PREPARE', 'EMAIL_APPROVE'],
    );
    assert.equal(Number(audit[1].actor_user_id), h.admin.id);

    // It cannot be approved or sent a second time.
    assert.equal(
      (await h.api(`/email-log/${id}/approve`, { method: 'POST', ...h.asAdmin, body: {} })).status,
      404,
    );
    const duplicate = await prepare(candidate, hr);
    assert.equal(duplicate.status, 422);
    assert.match(duplicate.body.fields.mail, /Resend/);
    assert.equal((await logOf(candidate.id)).length, 1);
  });

  test('a rejected mail is never sent, is audited, and a corrected one can be prepared', async () => {
    const candidate = await candidateWithOffer('Approval Sample Five');
    const id = (await prepare(candidate, hr)).body.logId;

    const res = await h.api(`/email-log/${id}/reject`, {
      method: 'POST',
      ...h.asAdmin,
      body: { reason: 'Wrong joining date' },
    });
    assert.equal(res.status, 200);

    const [row] = await logOf(candidate.id);
    assert.equal(row.status, 'failed');
    assert.equal(row.sent_at, null);
    assert.match(row.error, /Rejected by the Main User: Wrong joining date/);
    assert.ok((await auditActions(h, 'email_log', id)).includes('EMAIL_REJECT'));
    // The rejected mail cannot be approved afterwards.
    assert.equal(
      (await h.api(`/email-log/${id}/approve`, { method: 'POST', ...h.asAdmin, body: {} })).status,
      404,
    );
    // A corrected mail can be prepared again.
    assert.equal((await prepare(candidate, hr)).status, 201);
  });

  test('the Main User’s own send is the approval and goes straight out', async () => {
    const candidate = await candidateWithOffer('Approval Sample Six');
    const res = await h.api(`/candidates/${candidate.id}/emails/send`, {
      method: 'POST',
      ...h.asAdmin,
      body: { type: 'joining_onboarding' },
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.delivered, true);
    assert.equal((await logOf(candidate.id))[0].status, 'sent');
  });

  test('a Team Lead or Intern cannot send or list the offer mail at all', async () => {
    const candidate = await candidateWithOffer('Approval Sample Seven');
    const lead = await prepare(candidate, teamLead);
    assert.equal(lead.status, 403);
    assert.equal((await h.api('/email-approvals', { cookie: teamLead.cookie })).status, 403);
    // Intern / Dev may prepare (test data), but cannot approve.
    const prepared = await prepare(candidate, intern);
    assert.equal(prepared.body.pendingApproval, true);
  });

  test('salary never appears in the joining mail, its log, the waiting list, or for HR', async () => {
    const candidate = await candidateWithOffer('Approval Sample Eight');
    await h.api(`/salary/${candidate.id}`, {
      method: 'PUT',
      ...h.asAdmin,
      body: { salaryLkr: SALARY },
    });
    const prepared = await prepare(candidate, hr, {
      body: 'Edited by HR. {salary} {salary_lkr}',
    });
    assert.equal(prepared.status, 201);

    const waiting = await h.api('/email-approvals', h.asAdmin);
    assert.doesNotMatch(JSON.stringify(waiting.body), new RegExp(String(SALARY)));
    await h.api(`/email-log/${prepared.body.logId}/approve`, {
      method: 'POST',
      ...h.asAdmin,
      body: {},
    });

    const logs = await logOf(candidate.id);
    assert.doesNotMatch(JSON.stringify(logs), new RegExp(String(SALARY)));
    // Placeholders for salary are never substituted.
    assert.match(logs[0].body_sent, /\{salary\}/);
    // HR still cannot read it.
    assert.equal((await h.api(`/salary/${candidate.id}`, { cookie: hr.cookie })).status, 403);
    assert.doesNotMatch(
      JSON.stringify(await h.api('/email-approvals', { cookie: hr.cookie })),
      new RegExp(String(SALARY)),
    );
  });

  test('resend of an approved mail by HR waits for approval again and is logged as a resend', async () => {
    const candidate = await candidateWithOffer('Approval Sample Nine');
    const id = (await prepare(candidate, hr)).body.logId;
    await h.api(`/email-log/${id}/approve`, { method: 'POST', ...h.asAdmin, body: {} });

    const resend = await prepare(candidate, hr, { resend: true });
    assert.equal(resend.status, 201, JSON.stringify(resend.body));
    assert.equal(resend.body.pendingApproval, true);
    const logs = await logOf(candidate.id);
    assert.equal(logs.length, 2);
    assert.equal(logs[1].is_resend, true);
    assert.equal(logs[1].status, 'queued');
  });
});

describe('Auto-send and Review-then-send', () => {
  test('a template set to Auto sends by itself; One-click waits for a person', async () => {
    const make = (type, sendMode) =>
      h.api('/email-templates', {
        method: 'POST',
        ...h.asAdmin,
        body: { type, subject: `${type} {name}`, body: 'Hello {name} {date}', sendMode },
      });
    assert.equal((await make('interview_invitation', 'one_click')).status, 201);
    assert.equal((await make('team_lead_summary', 'auto')).status, 201);
    const lead = await h.api('/admin/team-leads', {
      method: 'POST',
      ...h.asAdmin,
      body: { positionId: position.id, name: 'Sample Lead', email: 'lead.approval@example.test' },
    });
    assert.equal(lead.status, 201);

    const candidate = await h.newCandidate({ positionId: position.id, fullName: 'Mode Sample' });
    await h.phoneSelected(candidate, inDays(4));

    const rows = await h.query(
      `SELECT t.type, l.status FROM email_log l JOIN email_templates t ON t.id = l.template_id
        WHERE l.candidate_id = $1`,
      [candidate.id],
    );
    // Auto: sent by the system. One-click (review-then-send): not sent yet.
    assert.deepEqual(rows, [{ type: 'team_lead_summary', status: 'sent' }]);

    // The Main User can switch the same type between the two modes.
    const invitation = (await h.api('/email-templates', h.asAdmin)).body.items.find(
      (t) => t.type === 'interview_invitation',
    );
    const toAuto = await h.api(`/email-templates/${invitation.id}`, {
      method: 'PATCH',
      ...h.asAdmin,
      body: { sendMode: 'auto' },
    });
    assert.equal(toAuto.body.template.sendMode, 'auto');

    // Review-then-send: preview first, then one click.
    const other = await h.newCandidate({ positionId: position.id, fullName: 'Review Sample' });
    await h.phoneSelected(other, inDays(5));
    const autoRows = await h.query(
      `SELECT t.type FROM email_log l JOIN email_templates t ON t.id = l.template_id
        WHERE l.candidate_id = $1 ORDER BY l.id`,
      [other.id],
    );
    assert.deepEqual(
      autoRows.map((r) => r.type),
      ['interview_invitation', 'team_lead_summary'],
    );
  });

  test('only the allowed modes exist: there is no third mode', async () => {
    const bad = await h.api('/email-templates', {
      method: 'POST',
      ...h.asAdmin,
      body: { type: 'status_rejected_on_hold', subject: 's', body: 'b', sendMode: 'review' },
    });
    assert.equal(bad.status, 422);
    assert.match(bad.body.fields.sendMode, /auto or one_click/);
  });
});
