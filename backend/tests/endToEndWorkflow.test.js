import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { inDays, isoDay, startHarness } from './helpers/harness.js';
import { createTestRole } from './helpers/testDb.js';

// The whole recruitment journey in one throwaway schema, with made-up people:
// registration -> list -> phone interview -> direct interview with scores ->
// Selected -> offer -> accepted -> joined -> evaluation -> probation -> junior
// -> exit. Along the way: message and email previews, a development-mode send,
// the email log, the dashboard, a report, an export, the audit log and role
// restrictions. Nothing here touches the real database or sends anything.

let h;
let position;
let person;
let employeeId;

const get = (path, who = h.asAdmin) => h.api(path, who);
const post = (path, body, who = h.asAdmin) => h.api(path, { method: 'POST', ...who, body });
const patch = (path, body, who = h.asAdmin) => h.api(path, { method: 'PATCH', ...who, body });

before(async () => {
  h = await startHarness();
  position = await h.lookup('positions', 'Journey Position');
  await h.setSetting('interview_venue', 'Journey Office');
  await post('/admin/team-leads', {
    positionId: position.id,
    name: 'Journey Lead',
    email: 'journey.lead@example.test',
  });
  for (const type of ['interview_invitation', 'joining_onboarding']) {
    const res = await post('/email-templates', {
      type,
      subject: `${type} for {name}`,
      body: 'Hello {name}, {position}, {date} {time}, {venue}.',
      sendMode: 'one_click',
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
  }
});

after(async () => {
  await h.stop();
});

describe('journey from registration to exit', () => {
  test('1. a registered candidate is saved once and appears in the list', async () => {
    person = await h.newCandidate({ positionId: position.id, fullName: 'Journey Person' });
    const list = await get('/candidates?search=Journey%20Person');
    assert.equal(list.body.total, 1);
    assert.equal(list.body.items[0].candidateCode, person.candidateCode);
    assert.equal(list.body.items[0].stage.code, 'applied');
    // Registering the same person again is warned about and saves nothing.
    const again = await post('/candidates', {
      fullName: 'Journey Person',
      phone: person.phone,
    });
    assert.equal(again.status, 409, 'the same person is not saved twice');
    assert.equal((await get('/candidates?search=Journey%20Person')).body.total, 1);
  });

  test('2. no interview yet: the invitation text says what is missing', async () => {
    const res = await post(`/candidates/${person.id}/messages/preview`, {
      type: 'interview_invitation',
    });
    assert.deepEqual(res.body.missing, ['interview date and time']);
    assert.match(res.body.hint, /No interview has been scheduled/);
  });

  test('3. the phone interview selects the candidate with a slot', async () => {
    await h.phoneSelected(person, inDays(2));
    const stage = (await get(`/candidates/${person.id}`)).body.candidate.stage.code;
    assert.equal(stage, 'interview_scheduled');
  });

  test('4. the saved slot now fills the messages and the email preview', async () => {
    const text = await post(`/candidates/${person.id}/messages/preview`, {
      type: 'interview_invitation',
    });
    assert.equal(text.body.canCopy, true);
    assert.match(text.body.text, /^Hello Journey Person,/);
    const mail = await post(`/candidates/${person.id}/emails/preview`, {
      type: 'interview_invitation',
    });
    assert.equal(mail.body.canSend, true);
    assert.equal(mail.body.deliveryMode, 'development');
  });

  test('5. a development send is logged once, and a repeat is refused', async () => {
    const send = () =>
      post(`/candidates/${person.id}/emails/send`, { type: 'interview_invitation' });
    const first = await send();
    assert.equal(first.status, 201, JSON.stringify(first.body));
    assert.equal(first.body.simulated, true);
    assert.equal((await send()).status, 422);
    const logged = await h.query('SELECT status FROM email_log WHERE candidate_id = $1', [
      person.id,
    ]);
    assert.equal(logged.length, 1);
  });

  test('6. direct interview with scores out of 50 and decision Selected', async () => {
    const res = await h.directInterview(person, inDays(2), {
      attendance: 'attended',
      scoreTechnical: 8,
      scoreAi: 7,
      scoreCommunication: 9,
      scoreConfidence: 6,
      scoreCultureFit: 10,
      decision: 'selected',
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const total = (
      await h.query('SELECT total_score FROM interviews WHERE candidate_id = $1', [person.id])
    )[0].total_score;
    assert.equal(Number(total), 40);
    const stage = (await get(`/candidates/${person.id}`)).body.candidate.stage.code;
    assert.equal(stage, 'selected');
  });

  test('7. Selected creates exactly one offer; it is accepted with a joining date', async () => {
    const offers = await h.query('SELECT id FROM offers WHERE candidate_id = $1', [person.id]);
    assert.equal(offers.length, 1);
    const res = await patch(`/offers/${offers[0].id}`, {
      offerStatus: 'accepted',
      onboardingDate: isoDay(inDays(10)),
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const none = await h.query('SELECT id FROM employees WHERE candidate_id = $1', [person.id]);
    assert.equal(none.length, 0, 'an accepted offer is not yet a joined employee');
  });

  test('8. the joining text uses the saved date; confirming joining makes one employee', async () => {
    const text = await post(`/candidates/${person.id}/messages/preview`, {
      type: 'joining_onboarding',
    });
    assert.equal(text.body.canCopy, true, JSON.stringify(text.body));

    const [offer] = await h.query('SELECT id FROM offers WHERE candidate_id = $1', [person.id]);
    for (let i = 0; i < 2; i += 1) {
      const res = await patch(`/offers/${offer.id}`, { attended: true });
      assert.equal(res.status, 200, JSON.stringify(res.body));
    }
    const rows = await h.query('SELECT id, current_phase FROM employees WHERE candidate_id = $1', [
      person.id,
    ]);
    assert.equal(rows.length, 1, 'saving twice never creates a second employee');
    assert.equal(rows[0].current_phase, 'evaluation');
    employeeId = Number(rows[0].id);
    const stage = (await get(`/candidates/${person.id}`)).body.candidate.stage.code;
    assert.equal(stage, 'joined');
  });

  test('9. evaluation, probation, junior, then exit', async () => {
    const decide = (body) => post(`/employees/${employeeId}/decision`, body);
    const phase = async () =>
      (await h.query('SELECT current_phase FROM employees WHERE id = $1', [employeeId]))[0]
        .current_phase;
    assert.equal((await decide({ result: 'pass' })).status, 200);
    assert.equal(await phase(), 'probation');
    assert.equal((await decide({ result: 'pass' })).status, 200);
    assert.equal(await phase(), 'junior');

    const exit = await post(`/employees/${employeeId}/termination`, {
      reason: 'Journey test exit',
      exitDate: isoDay(inDays(400)),
    });
    assert.equal(exit.status, 200, JSON.stringify(exit.body));
    assert.equal(exit.body.employee.status, 'terminated');
  });
});

describe('what the rest of the system shows afterwards', () => {
  test('dashboard counts, report and exports agree with the database', async () => {
    const dash = (await get('/dashboard/summary')).body;
    const total = Number((await h.query('SELECT count(*) AS n FROM candidates'))[0].n);
    assert.equal(dash.counts.totalCandidates, total);
    assert.equal(dash.counts.joined, 1);
    assert.equal(dash.counts.terminated, 1);
    assert.equal(dash.counts.currentlyWorking, 0);

    assert.equal((await get('/reports/candidate-status')).status, 200);
    for (const format of ['csv', 'xlsx', 'pdf']) {
      const res = await h.raw(`/api/reports/candidate-status/export?format=${format}`, h.asAdmin);
      assert.equal(res.status, 200, format);
    }
    const csv = await (
      await h.raw('/api/reports/candidate-status/export?format=csv', h.asAdmin)
    ).text();
    assert.ok(csv.includes(person.candidateCode));
  });

  test('every step was audited, and the roles are restricted', async () => {
    const audit = await get('/admin/audit-log?pageSize=100');
    assert.equal(audit.status, 200);
    assert.ok(audit.body.items.length > 5);

    await createTestRole(h.db.pool, 'journey_viewer', ['candidates.view']);
    const viewer = await h.signedIn({ roleCode: 'journey_viewer' });
    const as = { cookie: viewer.cookie };
    assert.equal((await get('/admin/audit-log', as)).status, 403);
    assert.equal((await get('/dashboard/summary', as)).status, 200);
    assert.equal(
      (await post(`/candidates/${person.id}/emails/send`, { type: 'interview_invitation' }, as))
        .status,
      403,
    );
    assert.equal((await get('/salary/1', as)).status, 403);
    assert.equal((await h.api('/candidates', {})).status, 401);
  });
});
