import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { runNotificationScheduler } from '../src/modules/notifications/notifications.service.js';
import { inDays, startHarness } from './helpers/harness.js';

// Stage 11: the Company CV flow. IMPLEMENTED_FROM_TASK_GUIDE for the flow;
// the storage is a development-only local folder, NOT a production choice
// (the guide names no provider). No real CV is used: the "files" are a few
// made-up bytes.

const HR = 'hr.sample@example.test';
const LEAD = 'lead.sample@example.test';
const PDF = Buffer.from('%PDF-1.4\n% made-up sample, not a real CV\n%%EOF\n');

let h;
let storageDir;
let hr;
let teamLead;
let teamLeadOther;
let position;
let otherPosition;
const spyCalls = [];
const spy = {
  mode: 'test-spy',
  send: async (mail) => {
    spyCalls.push(mail);
    return { delivered: false, simulated: true };
  },
};

const tokenFrom = (text) => text.match(/company-cv\/upload\/([A-Za-z0-9_-]+)/)[1];
const upload = (token, body = PDF, type = 'application/pdf') =>
  h.raw(`/api/public/company-cv/${token}`, {
    method: 'PUT',
    headers: { 'Content-Type': type },
    rawBody: body,
  });

// A candidate at "Interview Scheduled" whose invitation has been sent.
async function invited(fullName) {
  const candidate = await h.newCandidate({ positionId: position.id, fullName });
  await h.phoneSelected(candidate, inDays(4));
  const sent = await h.api(`/candidates/${candidate.id}/emails/send`, {
    method: 'POST',
    ...h.asAdmin,
    body: { type: 'interview_invitation' },
  });
  assert.equal(sent.status, 201, JSON.stringify(sent.body));
  const [log] = await h.query(
    'SELECT body_sent FROM email_log WHERE candidate_id = $1 ORDER BY id DESC',
    [candidate.id],
  );
  return { candidate, token: tokenFrom(log.body_sent) };
}

before(async () => {
  storageDir = await mkdtemp(path.join(tmpdir(), 'company-cv-test-'));
  h = await startHarness({
    config: { devStorageDir: storageDir, publicBaseUrl: 'http://app.example.test' },
  });
  hr = await h.signedIn({ roleCode: 'hr' });
  teamLead = await h.signedIn({ roleCode: 'team_lead' });
  teamLeadOther = await h.signedIn({ roleCode: 'team_lead' });
  position = await h.lookup('positions', 'Sample Position');
  otherPosition = await h.lookup('positions', 'Other Position');

  for (const [pos, user, email] of [
    [position, teamLead, LEAD],
    [otherPosition, teamLeadOther, 'other.lead@example.test'],
  ]) {
    await h.api('/admin/team-leads', {
      method: 'POST',
      ...h.asAdmin,
      body: { positionId: pos.id, name: 'Sample Lead', email, userId: user.id },
    });
  }
  await h.setSetting('reminder_hr_emails', HR);
  await h.setSetting('interview_venue', 'Sample Office');
  await h.setSetting('company_cv_template_url', 'https://example.test/company-cv-template');

  for (const [type, body] of [
    [
      'interview_invitation',
      'Hello {name}. Fill {company_cv_template} and upload at {company_cv_upload_link}.',
    ],
    ['interview_reminder', 'Reminder {name} {date} {time}.'],
    [
      'cv_pending_reminder',
      'Hello {name}, your Company CV is still missing: {company_cv_upload_link}.',
    ],
  ]) {
    const res = await h.api('/email-templates', {
      method: 'POST',
      ...h.asAdmin,
      body: {
        type,
        subject: `${type} {name}`,
        body,
        sendMode: type === 'interview_invitation' ? 'one_click' : 'auto',
      },
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
  }
});

after(async () => {
  await h.stop();
  await rm(storageDir, { recursive: true, force: true });
});

describe('the template', () => {
  test('is a setting HR replaces without a code change, and must be a web link', async () => {
    const bad = await h.api('/admin/settings/company_cv_template_url', {
      method: 'PATCH',
      ...h.asAdmin,
      body: { value: 'not a link' },
    });
    assert.equal(bad.status, 422);

    const ok = await h.api('/admin/settings/company_cv_template_url', {
      method: 'PATCH',
      ...h.asAdmin,
      body: { value: 'https://example.test/company-cv-template-v2' },
    });
    assert.equal(ok.status, 200);
    await h.setSetting('company_cv_template_url', 'https://example.test/company-cv-template');
  });
});

describe('the invitation and the upload link', () => {
  test('the invitation carries the template and a link unique to the candidate', async () => {
    const a = await invited('Invite Sample A');
    const b = await invited('Invite Sample B');
    const [log] = await h.query('SELECT body_sent FROM email_log WHERE candidate_id = $1', [
      a.candidate.id,
    ]);
    assert.match(log.body_sent, /https:\/\/example\.test\/company-cv-template/);
    assert.match(log.body_sent, /http:\/\/app\.example\.test\/company-cv\/upload\//);
    assert.notEqual(a.token, b.token);

    const detail = await h.api(`/candidates/${a.candidate.id}`, h.asAdmin);
    assert.equal(detail.body.candidate.companyCvStatus, 'sent');
  });

  test('only a hash of the link is stored', async () => {
    const { token } = await invited('Hash Sample');
    const rows = await h.query('SELECT token_hash FROM company_cv_links');
    assert.ok(rows.every((row) => /^[0-9a-f]{64}$/.test(row.token_hash)));
    assert.ok(!JSON.stringify(rows).includes(token));
  });
});

describe('the candidate uploads the CV', () => {
  test('success stores the result in company_cv_url and the status becomes Received', async () => {
    const { candidate, token } = await invited('Upload Sample');

    const check = await h.api(`/public/company-cv/${token}`);
    assert.equal(check.status, 200);

    const res = await upload(token);
    assert.equal(res.status, 201);
    // Nothing about the candidate is returned to the holder of the link.
    assert.deepEqual(await res.json(), { ok: true });

    const detail = (await h.api(`/candidates/${candidate.id}`, h.asAdmin)).body.candidate;
    assert.equal(detail.companyCvStatus, 'received');
    assert.equal(detail.companyCvPending, false);
    assert.match(
      detail.companyCvUrl,
      /^http:\/\/app\.example\.test\/api\/company-cv-files\/[0-9a-f]{32}\.pdf$/,
    );

    // HR opens the stored file; the bytes are the ones uploaded.
    const file = await h.raw(new URL(detail.companyCvUrl).pathname, { cookie: hr.cookie });
    assert.equal(file.status, 200);
    assert.equal(file.headers.get('content-type'), 'application/pdf');
    assert.deepEqual(Buffer.from(await file.arrayBuffer()), PDF);

    const audit = await h.query(
      `SELECT action FROM audit_log WHERE action = 'COMPANY_CV_RECEIVED' AND entity_id = $1`,
      [candidate.id],
    );
    assert.equal(audit.length, 1);
  });

  test('a link works once, a made-up link is refused, and an expired one is refused', async () => {
    const { token } = await invited('Once Sample');
    assert.equal((await upload(token)).status, 201);
    assert.equal((await upload(token)).status, 410);
    assert.equal((await h.api(`/public/company-cv/${token}`)).status, 410);

    assert.equal((await upload('A'.repeat(32))).status, 404);

    const expired = await invited('Expired Sample');
    await h.query(
      `UPDATE company_cv_links SET created_at = now() - interval '30 days',
              expires_at = now() - interval '1 day' WHERE token_hash <> 'x'
          AND candidate_id = $1`,
      [expired.candidate.id],
    );
    assert.equal((await upload(expired.token)).status, 410);
    const detail = (await h.api(`/candidates/${expired.candidate.id}`, h.asAdmin)).body.candidate;
    assert.equal(detail.companyCvStatus, 'sent');
  });

  test('only PDF or Word files are accepted, and a "PDF" must really be one', async () => {
    const { token } = await invited('Type Sample');
    assert.equal((await upload(token, Buffer.from('x'), 'image/png')).status, 415);
    assert.equal((await upload(token, Buffer.from('not a pdf'), 'application/pdf')).status, 422);
    assert.equal((await upload(token, Buffer.alloc(0), 'application/pdf')).status, 422);
    // Still usable after the refusals.
    assert.equal((await upload(token)).status, 201);
  });

  test('a file over 5 MB is refused', async () => {
    const { token } = await invited('Large Sample');
    const big = Buffer.concat([Buffer.from('%PDF-'), Buffer.alloc(5 * 1024 * 1024 + 10)]);
    const res = await upload(token, big);
    assert.equal(res.status, 413);
    const rows = await h.query('SELECT used_at FROM company_cv_links ORDER BY id DESC LIMIT 1');
    assert.equal(rows[0].used_at, null);
  });

  test('the stored file is read only by signed-in staff, and a Team Lead only for their own team', async () => {
    const { candidate, token } = await invited('Scoped Sample');
    await upload(token);
    const url = new URL(
      (await h.api(`/candidates/${candidate.id}`, h.asAdmin)).body.candidate.companyCvUrl,
    ).pathname;

    assert.equal((await h.raw(url)).status, 401);
    assert.equal((await h.raw(url, { cookie: teamLead.cookie })).status, 200);
    assert.equal((await h.raw(url, { cookie: teamLeadOther.cookie })).status, 404);
    assert.equal(
      (await h.raw('/api/company-cv-files/../../etc/passwd', { cookie: hr.cookie })).status,
      404,
    );
  });
});

describe('CV pending', () => {
  test('a candidate whose CV has not arrived is pending for HR and the Team Lead, and the interview screen shows the link', async () => {
    const candidate = await h.newCandidate({ positionId: position.id, fullName: 'Pending Sample' });
    await h.phoneSelected(candidate, inDays(4));
    await h.api(`/candidates/${candidate.id}/emails/send`, {
      method: 'POST',
      ...h.asAdmin,
      body: { type: 'interview_invitation' },
    });
    const interview = await h.directInterview(candidate, inDays(4));
    const id = interview.body.interview.id;

    for (const who of [hr, teamLead, h.admin]) {
      const detail = await h.api(`/interviews/${id}`, { cookie: who.cookie });
      assert.equal(detail.status, 200);
      assert.equal(detail.body.candidate.companyCvStatus, 'sent');
      assert.equal(detail.body.candidate.companyCvPending, true);
      assert.equal(detail.body.candidate.companyCvUrl, null);
      const list = await h.api('/interviews?search=Pending+Sample', { cookie: who.cookie });
      assert.equal(list.body.items[0].candidate.companyCvPending, true);
    }
  });

  test('24 hours before the interview, a missing CV sends the candidate a reminder and becomes Overdue', async () => {
    const { candidate, token } = await invited('Reminder Sample');
    // An interview tomorrow morning: the CV chase is due now.
    const interview = await h.directInterview(candidate, new Date(Date.now() + 20 * 3600 * 1000));
    assert.equal(interview.status, 201, JSON.stringify(interview.body));
    const [chase] = await h.query(
      `SELECT * FROM notifications WHERE candidate_id = $1 AND type = 'cv_pending'`,
      [candidate.id],
    );
    assert.equal(chase.status, 'pending');
    assert.deepEqual(chase.recipients, [candidate.email]);

    spyCalls.length = 0;
    await runNotificationScheduler(h.db.pool, spy, { config: h.config });

    const mail = spyCalls.find((call) => call.subject.startsWith('cv_pending_reminder'));
    assert.ok(mail, 'the reminder was handed to the mail adapter');
    assert.deepEqual(mail.to, [candidate.email]);
    assert.match(mail.body, /still missing/);
    assert.match(mail.body, /company-cv\/upload\//);
    // The reminder carries a fresh link, different from the invitation's.
    assert.notEqual(tokenFrom(mail.body), token);

    const detail = (await h.api(`/candidates/${candidate.id}`, h.asAdmin)).body.candidate;
    assert.equal(detail.companyCvStatus, 'overdue');
    assert.equal(detail.companyCvPending, true);

    // The fresh link works, and receiving the CV clears the pending state.
    assert.equal((await upload(tokenFrom(mail.body))).status, 201);
    const done = (await h.api(`/candidates/${candidate.id}`, h.asAdmin)).body.candidate;
    assert.equal(done.companyCvStatus, 'received');
    assert.match(done.companyCvUrl, /company-cv-files/);
  });

  test('no reminder is sent once the CV has arrived, and the waiting one is cancelled', async () => {
    const { candidate, token } = await invited('Received Sample');
    await h.directInterview(candidate, new Date(Date.now() + 20 * 3600 * 1000));
    assert.equal((await upload(token)).status, 201);

    const [chase] = await h.query(
      `SELECT status FROM notifications WHERE candidate_id = $1 AND type = 'cv_pending'`,
      [candidate.id],
    );
    assert.equal(chase.status, 'cancelled');

    spyCalls.length = 0;
    await runNotificationScheduler(h.db.pool, spy, { config: h.config });
    assert.ok(
      !spyCalls.some(
        (call) => call.to.includes(candidate.email) && /cv_pending/.test(call.subject),
      ),
    );
  });

  test('the CV status values are Not sent, Sent, Received and Overdue only', async () => {
    const bad = await h.query(
      // Only this test's own schema: other test files create and drop theirs at the
      // same time, and reading another schema's constraint while it is dropped fails.
      `SELECT pg_get_constraintdef(c.oid) AS d FROM pg_constraint c
         JOIN pg_namespace n ON n.oid = c.connamespace
        WHERE c.conname = 'candidates_company_cv_status_valid' AND n.nspname = current_schema()`,
    );
    assert.match(bad[0].d, /not_sent.*sent.*received.*overdue/s);
  });
});
