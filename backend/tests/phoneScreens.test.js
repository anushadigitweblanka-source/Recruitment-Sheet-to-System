import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { createApp } from '../src/app.js';
import { stageFor } from '../src/modules/phone-screens/phoneScreens.service.js';
import { createTestDatabase, createTestRole, createTestUser } from './helpers/testDb.js';

// Integration tests: a real server and real tables, in a throwaway schema.
// Every name, phone number and address below is made up.

let db;
let server;
let baseUrl;
let admin; // holds every permission
let viewer; // may view candidates, cannot record interviews
let outsider; // holds no permission
let nextCode = 1;

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
      candidateCode: `PS-${String(n).padStart(4, '0')}`,
      fullName: `Phone Sample ${n}`,
      phone: `07200${String(n).padStart(5, '0')}`,
      ...overrides,
    },
  });
  return res.body.candidate;
}

const record = (body, who = admin) =>
  api('/phone-interviews', { method: 'POST', body, cookie: who.cookie });
const change = (id, body, who = admin) =>
  api(`/phone-interviews/${id}`, { method: 'PATCH', body, cookie: who.cookie });
const view = (candidateId, who = admin) =>
  api(`/candidates/${candidateId}/phone-interview`, { cookie: who.cookie });
const SLOT = '2026-11-02T10:00:00+05:30';

const stageOf = async (candidateId) =>
  (
    await db.pool.query(
      'SELECT current_stage, reject_reason FROM pipeline_status WHERE candidate_id = $1',
      [candidateId],
    )
  ).rows[0];
const historyOf = async (candidateId) =>
  (
    await db.pool.query(
      'SELECT from_stage, to_stage, reason, changed_by FROM stage_history WHERE candidate_id = $1 ORDER BY id',
      [candidateId],
    )
  ).rows;
const auditActions = async (candidateId, screenId) =>
  (
    await db.pool.query(
      `SELECT action FROM audit_log
        WHERE (entity_type = 'phone_screens' AND entity_id = $2)
           OR (entity_type = 'candidates' AND entity_id = $1 AND action = 'PIPELINE_STAGE_CHANGE')
        ORDER BY id`,
      [candidateId, screenId],
    )
  ).rows.map((row) => row.action);

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
    assert.equal((await api('/phone-interviews')).status, 401);
    assert.equal((await api('/candidates/1/phone-interview')).status, 401);
    assert.equal(
      (await api('/phone-interviews', { method: 'POST', body: { candidateId: 1 } })).status,
      401,
    );
    assert.equal((await api('/phone-interviews/1', { method: 'PATCH', body: {} })).status, 401);
  });

  test('a user with no permission is refused', async () => {
    assert.equal((await api('/phone-interviews', { cookie: outsider.cookie })).status, 403);
  });

  test('a view-only user can read but cannot record or change', async () => {
    const candidate = await newCandidate();
    const created = await record({ candidateId: candidate.id, called: true });

    assert.equal((await api('/phone-interviews', { cookie: viewer.cookie })).status, 200);
    assert.equal((await view(candidate.id, viewer)).status, 200);
    assert.equal((await record({ candidateId: (await newCandidate()).id }, viewer)).status, 403);
    assert.equal(
      (await change(created.body.phoneScreen.id, { called: false }, viewer)).status,
      403,
    );
  });
});

describe('recording a phone interview', () => {
  test('saves the call and returns it with the candidate', async () => {
    const candidate = await newCandidate();
    const res = await record({
      candidateId: candidate.id,
      called: true,
      review: 'Sample remark about the call',
    });

    assert.equal(res.status, 201);
    assert.equal(res.body.candidate.id, candidate.id);
    assert.equal(res.body.candidate.candidateCode, candidate.candidateCode);
    assert.equal(res.body.phoneScreen.called, true);
    assert.equal(res.body.phoneScreen.result, null);
    assert.equal(res.body.phoneScreen.review, 'Sample remark about the call');
    assert.equal(res.body.phoneScreen.response, null);
  });

  test('a candidate with no phone interview yet is returned with none', async () => {
    const candidate = await newCandidate();
    const res = await view(candidate.id);

    assert.equal(res.status, 200);
    assert.equal(res.body.phoneScreen, null);
    assert.equal(res.body.candidate.stage.code, 'applied');
  });

  test('refuses a candidate that does not exist', async () => {
    const res = await record({ candidateId: 999999, called: true });

    assert.equal(res.status, 422);
    assert.match(res.body.fields.candidateId, /does not exist/);
    assert.equal((await view(999999)).status, 404);
  });

  test('refuses a missing or malformed candidate', async () => {
    assert.equal((await record({ called: true })).status, 422);
    assert.equal((await record({ candidateId: 'abc' })).status, 422);
  });

  test('reports badly formed values field by field', async () => {
    const candidate = await newCandidate();
    const res = await record({
      candidateId: candidate.id,
      called: 'yes',
      result: 'maybe',
      review: 'x'.repeat(2001),
      interviewAt: 'next Tuesday',
    });

    assert.equal(res.status, 422);
    assert.deepEqual(Object.keys(res.body.fields).sort(), [
      'called',
      'interviewAt',
      'result',
      'review',
    ]);
    assert.equal((await view(candidate.id)).body.phoneScreen, null);
  });

  test('accepts only the two results named in the guide', async () => {
    for (const result of ['on_hold', 'Selected', 'rejected']) {
      const res = await record({ candidateId: (await newCandidate()).id, result });
      assert.equal(res.status, 422, result);
    }
  });

  const RESPONSES = [
    'Interested',
    'Not Interested',
    'Call Back Later',
    'No Answer',
    'Busy',
    'Not Reachable',
    'Wrong Number',
  ];

  test('saves each of the seven Response values and returns it after reloading', async () => {
    for (const response of RESPONSES) {
      const candidate = await newCandidate();
      const res = await record({ candidateId: candidate.id, called: true, response });
      assert.equal(res.status, 201, `${response}: ${JSON.stringify(res.body)}`);
      assert.equal(res.body.phoneScreen.response, response);
      assert.equal((await view(candidate.id)).body.phoneScreen.response, response);
    }
  });

  test('rejects a Response outside the seven, whatever its spelling', async () => {
    for (const response of ['Answered', 'interested', 'NO ANSWER', 'Busy ', 42, {}]) {
      const res = await record({ candidateId: (await newCandidate()).id, response });
      assert.equal(res.status, 422, JSON.stringify(response));
      assert.ok(res.body.fields.response, JSON.stringify(response));
    }
  });

  test('Response is optional, and clearing it saves nothing in its place', async () => {
    const candidate = await newCandidate();
    const created = await record({ candidateId: candidate.id, called: true });
    assert.equal(created.status, 201);
    assert.equal(created.body.phoneScreen.response, null);

    const id = created.body.phoneScreen.id;
    assert.equal((await change(id, { response: 'Busy' })).body.phoneScreen.response, 'Busy');
    assert.equal((await change(id, { response: null })).body.phoneScreen.response, null);
    assert.equal((await change(id, { response: '' })).body.phoneScreen.response, null);
  });

  test('Response never changes the Result or the stage, and changing it is audited', async () => {
    for (const response of RESPONSES) {
      const candidate = await newCandidate();
      const res = await record({ candidateId: candidate.id, called: true, response });
      assert.equal(res.body.phoneScreen.result, null, response);
      assert.equal(res.body.candidate.stage.code, 'applied', response);
      assert.deepEqual(await stageOf(candidate.id), {
        current_stage: 'applied',
        reject_reason: null,
      });
    }

    const candidate = await newCandidate();
    const created = await record({ candidateId: candidate.id, called: true });
    const id = created.body.phoneScreen.id;
    await change(id, { response: 'Not Interested' });
    const {
      rows: [row],
    } = await db.pool.query(
      `SELECT old_values, new_values FROM audit_log WHERE action = 'PHONE_SCREEN_UPDATE' AND entity_id = $1`,
      [id],
    );
    assert.deepEqual(row.old_values, { response: null });
    assert.deepEqual(row.new_values, { response: 'Not Interested' });
    assert.equal((await stageOf(candidate.id)).current_stage, 'applied');
  });

  test('a record whose Response is still empty can be edited like any other', async () => {
    const candidate = await newCandidate();
    const created = await record({ candidateId: candidate.id, called: true, review: 'Old note' });
    const res = await change(created.body.phoneScreen.id, { review: 'New note' });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.phoneScreen.response, null);
    assert.equal(res.body.phoneScreen.review, 'New note');
  });

  test('an interview date needs the result Selected, and a time zone', async () => {
    const notSelected = await record({
      candidateId: (await newCandidate()).id,
      result: 'not_selected',
      rejectReason: 'Sample reason',
      interviewAt: SLOT,
    });
    const noResult = await record({ candidateId: (await newCandidate()).id, interviewAt: SLOT });
    const noZone = await record({
      candidateId: (await newCandidate()).id,
      result: 'selected',
      interviewAt: '2026-11-02T10:00:00',
    });

    for (const res of [notSelected, noResult, noZone]) {
      assert.equal(res.status, 422);
      assert.ok(res.body.fields.interviewAt);
    }
  });

  test('Not Selected needs a reason for rejection', async () => {
    const candidate = await newCandidate();
    const res = await record({ candidateId: candidate.id, called: true, result: 'not_selected' });

    assert.equal(res.status, 422);
    assert.match(res.body.fields.rejectReason, /required/);
    assert.equal((await stageOf(candidate.id)).current_stage, 'applied');
  });

  test('a second record for the same candidate is refused, pointing to the first', async () => {
    const candidate = await newCandidate();
    await record({ candidateId: candidate.id, called: true });
    const res = await record({ candidateId: candidate.id, called: true });

    assert.equal(res.status, 409);
    assert.equal(res.body.error, 'already_exists');
    assert.equal(res.body.candidateId, candidate.id);
  });

  test('the table itself still allows more than one attempt per candidate', async () => {
    const { rows } = await db.pool.query(
      `SELECT count(*)::int AS unique_rules FROM pg_indexes
        WHERE schemaname = $1 AND tablename = 'phone_screens'
          AND indexdef LIKE 'CREATE UNIQUE%' AND indexdef LIKE '%candidate_id%'`,
      [db.schema],
    );

    assert.equal(rows[0].unique_rules, 0);
  });
});

describe('stage changes', () => {
  test('the mapping from outcome to stage', () => {
    assert.equal(stageFor({ result: 'selected', interviewAt: SLOT }), 'interview_scheduled');
    assert.equal(stageFor({ result: 'selected', interviewAt: null }), 'phone_screened');
    assert.equal(stageFor({ result: 'not_selected', interviewAt: null }), 'rejected');
    assert.equal(stageFor({ result: null, interviewAt: null }), null);
  });

  test('a call with no result yet leaves the candidate at Applied', async () => {
    const candidate = await newCandidate();
    await record({ candidateId: candidate.id, called: true });

    assert.equal((await stageOf(candidate.id)).current_stage, 'applied');
    assert.equal((await historyOf(candidate.id)).length, 1);
  });

  test('Selected moves the candidate to Phone Screened and adds a history row', async () => {
    const candidate = await newCandidate();
    const res = await record({ candidateId: candidate.id, called: true, result: 'selected' });

    assert.equal(res.body.candidate.stage.code, 'phone_screened');
    assert.deepEqual(await historyOf(candidate.id), [
      { from_stage: null, to_stage: 'applied', reason: null, changed_by: String(admin.id) },
      {
        from_stage: 'applied',
        to_stage: 'phone_screened',
        reason: null,
        changed_by: String(admin.id),
      },
    ]);
  });

  test('Selected with an interview date moves the candidate to Interview Scheduled', async () => {
    const candidate = await newCandidate();
    const res = await record({
      candidateId: candidate.id,
      called: true,
      result: 'selected',
      interviewAt: SLOT,
    });

    assert.equal(res.body.candidate.stage.code, 'interview_scheduled');
    assert.equal(res.body.phoneScreen.interviewAt, '2026-11-02T04:30:00.000Z');
  });

  test('Called, Result and the interview time are the same after reloading; Response stays empty', async () => {
    const candidate = await newCandidate();
    await record({
      candidateId: candidate.id,
      called: true,
      result: 'selected',
      interviewAt: SLOT,
    });

    const reloaded = (await view(candidate.id)).body.phoneScreen;
    assert.equal(reloaded.called, true);
    assert.equal(reloaded.result, 'selected');
    assert.equal(reloaded.interviewAt, '2026-11-02T04:30:00.000Z');
    assert.equal(reloaded.response, null);
  });

  test('Not Selected moves the candidate to Rejected and keeps the reason', async () => {
    const candidate = await newCandidate();
    const res = await record({
      candidateId: candidate.id,
      called: true,
      result: 'not_selected',
      rejectReason: 'Sample rejection reason',
    });

    assert.equal(res.body.candidate.stage.code, 'rejected');
    assert.equal(res.body.rejectReason, 'Sample rejection reason');
    assert.deepEqual(await stageOf(candidate.id), {
      current_stage: 'rejected',
      reject_reason: 'Sample rejection reason',
    });
    assert.equal((await historyOf(candidate.id))[1].reason, 'Sample rejection reason');
  });

  test('each later change adds a row; earlier history is never rewritten', async () => {
    const candidate = await newCandidate();
    const created = await record({ candidateId: candidate.id, called: true, result: 'selected' });
    const id = created.body.phoneScreen.id;
    const other = await signedIn();

    await change(id, { interviewAt: SLOT }, other);
    await change(
      id,
      { result: 'not_selected', interviewAt: null, rejectReason: 'Changed their mind' },
      other,
    );

    assert.deepEqual(
      (await historyOf(candidate.id)).map(
        (row) => `${row.from_stage}>${row.to_stage}:${row.changed_by}`,
      ),
      [
        `null>applied:${admin.id}`,
        `applied>phone_screened:${admin.id}`,
        `phone_screened>interview_scheduled:${other.id}`,
        `interview_scheduled>rejected:${other.id}`,
      ],
    );
  });

  test('moving out of Rejected clears the reason from the current status but not from history', async () => {
    const candidate = await newCandidate();
    const created = await record({
      candidateId: candidate.id,
      result: 'not_selected',
      rejectReason: 'Recorded by mistake',
    });
    await change(created.body.phoneScreen.id, { result: 'selected' });

    assert.deepEqual(await stageOf(candidate.id), {
      current_stage: 'phone_screened',
      reject_reason: null,
    });
    assert.equal((await historyOf(candidate.id))[1].reason, 'Recorded by mistake');
  });

  test('clearing a recorded result puts the candidate back to Applied', async () => {
    const candidate = await newCandidate();
    const created = await record({ candidateId: candidate.id, result: 'selected' });
    const res = await change(created.body.phoneScreen.id, { result: null });

    assert.equal(res.status, 200);
    assert.equal(res.body.candidate.stage.code, 'applied');
  });

  test('editing only the review does not touch the stage or its history', async () => {
    const candidate = await newCandidate();
    const created = await record({ candidateId: candidate.id, result: 'selected' });
    await change(created.body.phoneScreen.id, { review: 'Only the remark changed' });

    assert.equal((await stageOf(candidate.id)).current_stage, 'phone_screened');
    assert.equal((await historyOf(candidate.id)).length, 2);
  });

  test('correcting the rejection reason keeps the stage and adds no history row', async () => {
    const candidate = await newCandidate();
    const created = await record({
      candidateId: candidate.id,
      result: 'not_selected',
      rejectReason: 'First wording',
    });
    await change(created.body.phoneScreen.id, { rejectReason: 'Corrected wording' });

    assert.deepEqual(await stageOf(candidate.id), {
      current_stage: 'rejected',
      reject_reason: 'Corrected wording',
    });
    assert.equal((await historyOf(candidate.id)).length, 2);
  });

  test('a candidate who has moved further on is not pulled back, and nothing is saved', async () => {
    const candidate = await newCandidate();
    const created = await record({
      candidateId: candidate.id,
      result: 'selected',
      interviewAt: SLOT,
    });
    // A later module has moved the candidate on.
    await db.pool.query(
      `UPDATE pipeline_status SET current_stage = 'interviewed' WHERE candidate_id = $1`,
      [candidate.id],
    );

    const res = await change(created.body.phoneScreen.id, {
      result: 'not_selected',
      interviewAt: null,
      rejectReason: 'Too late',
    });

    assert.equal(res.status, 422);
    assert.match(res.body.fields.result, /already moved on to "Interviewed"/);
    assert.equal((await stageOf(candidate.id)).current_stage, 'interviewed');
    assert.equal((await view(candidate.id)).body.phoneScreen.result, 'selected');
  });

  test('other fields of such a candidate can still be edited', async () => {
    const candidate = await newCandidate();
    const created = await record({ candidateId: candidate.id, result: 'selected' });
    await db.pool.query(
      `UPDATE pipeline_status SET current_stage = 'interviewed' WHERE candidate_id = $1`,
      [candidate.id],
    );

    const res = await change(created.body.phoneScreen.id, { review: 'Added later' });

    assert.equal(res.status, 200);
    assert.equal(res.body.phoneScreen.review, 'Added later');
    assert.equal(res.body.candidate.stage.code, 'interviewed');
  });
});

describe('changing a phone interview', () => {
  test('changes only the fields that were sent', async () => {
    const candidate = await newCandidate();
    const created = await record({
      candidateId: candidate.id,
      called: true,
      review: 'Original remark',
    });
    const res = await change(created.body.phoneScreen.id, { result: 'selected' });

    assert.equal(res.status, 200);
    assert.equal(res.body.phoneScreen.result, 'selected');
    assert.equal(res.body.phoneScreen.called, true);
    assert.equal(res.body.phoneScreen.review, 'Original remark');
  });

  test('validates the change', async () => {
    const candidate = await newCandidate();
    const created = await record({ candidateId: candidate.id, called: true });
    const res = await change(created.body.phoneScreen.id, { result: 'not_selected' });

    assert.equal(res.status, 422);
    assert.ok(res.body.fields.rejectReason);
  });

  test('answers "not found" for an unknown or malformed id', async () => {
    assert.equal((await change(999999, { called: true })).status, 404);
    assert.equal((await change('abc', { called: true })).status, 404);
  });
});

describe('listing', () => {
  let listed;

  before(async () => {
    listed = {
      waiting: await newCandidate({
        fullName: 'Quokka Waiting',
        candidateCode: 'PSL-WAIT',
        phone: '0758880001',
      }),
      selected: await newCandidate({ fullName: 'Quokka Selected', phone: '0758880002' }),
      rejected: await newCandidate({ fullName: 'Quokka Rejected', phone: '0758880003' }),
      called: await newCandidate({ fullName: 'Quokka Called', phone: '0758880004' }),
    };
    await record({
      candidateId: listed.selected.id,
      called: true,
      result: 'selected',
      interviewAt: SLOT,
      review: 'Listing remark',
    });
    await record({
      candidateId: listed.rejected.id,
      called: true,
      result: 'not_selected',
      rejectReason: 'Sample reason',
    });
    await record({ candidateId: listed.called.id, called: true });
  });

  const list = (query = '') => api(`/phone-interviews${query}`, { cookie: admin.cookie });
  const names = (res) => res.body.items.map((item) => item.candidate.fullName).sort();

  test('includes candidates who have not been phoned yet', async () => {
    const res = await list('?search=Quokka');
    const waiting = res.body.items.find((item) => item.candidate.id === listed.waiting.id);

    assert.equal(res.body.total, 4);
    assert.equal(waiting.phoneScreen, null);
    assert.equal(waiting.candidate.stage.name, 'Applied');
  });

  test('returns only the fields the list screen needs', async () => {
    const res = await list('?search=Quokka%20Selected');
    const item = res.body.items[0];

    assert.deepEqual(Object.keys(item).sort(), ['candidate', 'phoneScreen']);
    assert.deepEqual(Object.keys(item.candidate).sort(), [
      'candidateCode',
      'fullName',
      'id',
      'mailStatus',
      'phone',
      'stage',
    ]);
    assert.equal(item.phoneScreen.result, 'selected');
    assert.equal(item.phoneScreen.review, 'Listing remark');
    assert.equal(item.candidate.phone, '0758880002');
  });

  test('searches by name, Candidate ID and phone digits', async () => {
    assert.deepEqual(names(await list('?search=quokka%20wait')), ['Quokka Waiting']);
    assert.deepEqual(names(await list('?search=psl-wait')), ['Quokka Waiting']);
    assert.deepEqual(names(await list(`?search=${encodeURIComponent('075 888 0003')}`)), [
      'Quokka Rejected',
    ]);
  });

  test('filters by result, including "not recorded yet"', async () => {
    assert.deepEqual(names(await list('?search=Quokka&result=selected')), ['Quokka Selected']);
    assert.deepEqual(names(await list('?search=Quokka&result=not_selected')), ['Quokka Rejected']);
    assert.deepEqual(names(await list('?search=Quokka&result=pending')), [
      'Quokka Called',
      'Quokka Waiting',
    ]);
  });

  test('filters by called', async () => {
    assert.deepEqual(names(await list('?search=Quokka&called=yes')), [
      'Quokka Called',
      'Quokka Rejected',
      'Quokka Selected',
    ]);
    assert.deepEqual(names(await list('?search=Quokka&called=no')), ['Quokka Waiting']);
  });

  test('pages through the results and caps the page size', async () => {
    const first = await list('?search=Quokka&pageSize=3&page=1');
    const second = await list('?search=Quokka&pageSize=3&page=2');

    assert.equal(first.body.total, 4);
    assert.equal(first.body.items.length, 3);
    assert.equal(second.body.items.length, 1);
    assert.equal((await list('?pageSize=9999')).body.pageSize, 100);
  });

  test('ignores an unknown filter value', async () => {
    assert.equal(
      (await list(`?search=Quokka&result=${encodeURIComponent("x' OR 1=1")}`)).body.total,
      4,
    );
  });
});

describe('audit log', () => {
  test('recording with an outcome writes the create and the stage change', async () => {
    const candidate = await newCandidate();
    const created = await record({ candidateId: candidate.id, called: true, result: 'selected' });

    assert.deepEqual(await auditActions(candidate.id, created.body.phoneScreen.id), [
      'PHONE_SCREEN_CREATE',
      'PIPELINE_STAGE_CHANGE',
    ]);
  });

  test('the stage change row says who, from what, to what and why', async () => {
    const candidate = await newCandidate();
    await record({
      candidateId: candidate.id,
      result: 'not_selected',
      rejectReason: 'Sample audit reason',
    });
    const { rows } = await db.pool.query(
      `SELECT actor_user_id, old_values, new_values, details FROM audit_log
        WHERE action = 'PIPELINE_STAGE_CHANGE' AND entity_id = $1`,
      [candidate.id],
    );

    assert.equal(rows[0].actor_user_id, String(admin.id));
    assert.deepEqual(rows[0].old_values, { stage: 'applied' });
    assert.deepEqual(rows[0].new_values, { stage: 'rejected' });
    assert.deepEqual(rows[0].details, { source: 'phone_interview', reason: 'Sample audit reason' });
  });

  test('an edit records only the fields that changed', async () => {
    const candidate = await newCandidate();
    const created = await record({ candidateId: candidate.id, called: false });
    await change(created.body.phoneScreen.id, { called: true });
    const { rows } = await db.pool.query(
      `SELECT old_values, new_values FROM audit_log WHERE action = 'PHONE_SCREEN_UPDATE' AND entity_id = $1`,
      [created.body.phoneScreen.id],
    );

    assert.deepEqual(rows[0].old_values, { called: false });
    assert.deepEqual(rows[0].new_values, { called: true });
  });

  test('an edit that changes nothing, and a refused save, record nothing', async () => {
    const candidate = await newCandidate();
    const created = await record({ candidateId: candidate.id, called: true });
    const id = created.body.phoneScreen.id;

    await change(id, { called: true });
    await change(id, { result: 'maybe' });

    assert.deepEqual(await auditActions(candidate.id, id), ['PHONE_SCREEN_CREATE']);
  });
});

describe('database rules', () => {
  test('a phone interview must belong to a candidate that exists', async () => {
    await assert.rejects(
      db.pool.query('INSERT INTO phone_screens (candidate_id) VALUES (999999)'),
      /phone_screens_candidate_id_fkey/,
    );
  });

  test('the result must be one of the two allowed values', async () => {
    const candidate = await newCandidate();

    await assert.rejects(
      db.pool.query(`INSERT INTO phone_screens (candidate_id, result) VALUES ($1, 'on_hold')`, [
        candidate.id,
      ]),
      /phone_screens_result_valid/,
    );
  });

  test('an interview date without the result Selected is refused', async () => {
    const candidate = await newCandidate();

    await assert.rejects(
      db.pool.query(
        `INSERT INTO phone_screens (candidate_id, interview_datetime) VALUES ($1, now())`,
        [candidate.id],
      ),
      /phone_screens_interview_needs_selected/,
    );
  });

  test('there is no column for mail status', async () => {
    const { rows } = await db.pool.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = $1 AND table_name = 'phone_screens' AND column_name ~ 'mail'`,
      [db.schema],
    );

    assert.deepEqual(rows, []);
  });
});
