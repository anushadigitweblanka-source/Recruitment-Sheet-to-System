import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { createApp } from '../src/app.js';
import { stageFor } from '../src/modules/interviews/interviews.service.js';
import { createTestDatabase, createTestRole, createTestUser } from './helpers/testDb.js';

// Integration tests: a real server and real tables, in a throwaway schema.
// Every name and phone number below is made up.

let db;
let server;
let baseUrl;
let admin; // holds every permission
let viewer; // may view candidates, cannot record interviews
let outsider; // holds no permission
let nextCode = 1;

const SLOT = '2026-11-02T10:00:00+05:30';
const SCORES = {
  scoreTechnical: 8,
  scoreAi: 7,
  scoreCommunication: 9,
  scoreConfidence: 6,
  scoreCultureFit: 10,
};
const ATTENDED = { scheduledAt: SLOT, attendance: 'attended', ...SCORES };

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

// A candidate as Module 1 creates them: at "Applied".
async function appliedCandidate(overrides = {}) {
  const n = nextCode;
  nextCode += 1;
  const res = await api('/candidates', {
    method: 'POST',
    cookie: admin.cookie,
    body: {
      candidateCode: `IV-${String(n).padStart(4, '0')}`,
      fullName: `Interview Sample ${n}`,
      phone: `07300${String(n).padStart(5, '0')}`,
      ...overrides,
    },
  });
  return res.body.candidate;
}

// A candidate taken through Module 2 to "Interview Scheduled".
async function scheduledCandidate(overrides) {
  const candidate = await appliedCandidate(overrides);
  const res = await api('/phone-interviews', {
    method: 'POST',
    cookie: admin.cookie,
    body: { candidateId: candidate.id, called: true, result: 'selected', interviewAt: SLOT },
  });
  assert.equal(res.body.candidate.stage.code, 'interview_scheduled');
  return candidate;
}

const record = (body, who = admin) =>
  api('/interviews', { method: 'POST', body, cookie: who.cookie });
const change = (id, body, who = admin) =>
  api(`/interviews/${id}`, { method: 'PATCH', body, cookie: who.cookie });
const view = (id, who = admin) => api(`/interviews/${id}`, { cookie: who.cookie });

// Records an interview for a fresh, scheduled candidate.
async function interviewed(body = {}) {
  const candidate = await scheduledCandidate();
  const res = await record({ candidateId: candidate.id, scheduledAt: SLOT, ...body });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return { candidate, id: res.body.interview.id, body: res.body };
}

const pipelineOf = async (candidateId) =>
  (
    await db.pool.query(
      `SELECT current_stage, hold_reason, reject_reason, to_char(next_followup_date, 'YYYY-MM-DD') AS next_followup_date
         FROM pipeline_status WHERE candidate_id = $1`,
      [candidateId],
    )
  ).rows[0];
const historyOf = async (candidateId) =>
  (
    await db.pool.query(
      'SELECT from_stage, to_stage, reason, changed_by FROM stage_history WHERE candidate_id = $1 ORDER BY id',
      [candidateId],
    )
  ).rows.map((row) => `${row.from_stage ?? 'none'}>${row.to_stage}`);
const auditActions = async (candidateId, interviewId) =>
  (
    await db.pool.query(
      `SELECT action FROM audit_log
        WHERE (entity_type = 'interviews' AND entity_id = $2)
           OR (entity_type = 'candidates' AND entity_id = $1 AND action = 'PIPELINE_STAGE_CHANGE'
               AND details->>'source' = 'direct_interview')
        ORDER BY id`,
      [candidateId, interviewId],
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
    assert.equal((await api('/interviews')).status, 401);
    assert.equal((await api('/interviews/1')).status, 401);
    assert.equal(
      (await api('/interviews', { method: 'POST', body: { candidateId: 1 } })).status,
      401,
    );
    assert.equal((await api('/interviews/1', { method: 'PATCH', body: {} })).status, 401);
  });

  test('a user with no permission is refused', async () => {
    assert.equal((await api('/interviews', { cookie: outsider.cookie })).status, 403);
  });

  test('a view-only user can read but cannot record or change', async () => {
    const { id } = await interviewed();
    const waiting = await scheduledCandidate();

    assert.equal((await api('/interviews', { cookie: viewer.cookie })).status, 200);
    assert.equal((await view(id, viewer)).status, 200);
    assert.equal(
      (await record({ candidateId: waiting.id, scheduledAt: SLOT }, viewer)).status,
      403,
    );
    assert.equal((await change(id, { remarks: 'x' }, viewer)).status, 403);
  });
});

describe('recording an interview', () => {
  test('saves it and returns it with the candidate', async () => {
    const candidate = await scheduledCandidate();
    const res = await record({
      candidateId: candidate.id,
      scheduledAt: SLOT,
      interviewerName: '  Sample Interviewer ',
      remarks: 'Sample remark',
    });

    assert.equal(res.status, 201);
    assert.equal(res.body.candidate.id, candidate.id);
    assert.equal(res.body.interview.scheduledAt, '2026-11-02T04:30:00.000Z');
    assert.equal(res.body.interview.interviewerName, 'Sample Interviewer');
    assert.equal(res.body.interview.remarks, 'Sample remark');
    assert.equal(res.body.interview.attendance, null);
    assert.equal(res.body.interview.totalScore, null);
    assert.equal(res.body.interview.decision, null);
  });

  test('refuses a candidate that does not exist, or none at all', async () => {
    const missing = await record({ candidateId: 999999, scheduledAt: SLOT });

    assert.equal(missing.status, 422);
    assert.match(missing.body.fields.candidateId, /does not exist/);
    assert.equal((await record({ scheduledAt: SLOT })).status, 422);
    assert.equal((await record({ candidateId: 'abc', scheduledAt: SLOT })).status, 422);
  });

  test('refuses a candidate who has not reached Interview Scheduled', async () => {
    const candidate = await appliedCandidate();
    const res = await record({ candidateId: candidate.id, scheduledAt: SLOT });

    assert.equal(res.status, 422);
    assert.match(res.body.fields.candidateId, /This candidate is at "Applied"/);
  });

  test('a second record for the same candidate is refused, pointing to the first', async () => {
    const { candidate, id } = await interviewed();
    const res = await record({ candidateId: candidate.id, scheduledAt: SLOT });

    assert.equal(res.status, 409);
    assert.equal(res.body.error, 'already_exists');
    assert.equal(res.body.interviewId, id);
  });

  test('needs the interview date and time, with a time zone', async () => {
    const candidate = await scheduledCandidate();

    for (const scheduledAt of [undefined, '', 'next Tuesday', '2026-11-02T10:00:00']) {
      const res = await record({ candidateId: candidate.id, scheduledAt });
      assert.equal(res.status, 422, String(scheduledAt));
      assert.ok(res.body.fields.scheduledAt);
    }
  });

  test('reports badly formed values field by field', async () => {
    const candidate = await scheduledCandidate();
    const res = await record({
      candidateId: candidate.id,
      scheduledAt: SLOT,
      attendance: 'maybe',
      decision: 'promoted',
      interviewerName: 'x'.repeat(151),
      remarks: 'x'.repeat(2001),
    });

    assert.equal(res.status, 422);
    assert.deepEqual(Object.keys(res.body.fields).sort(), [
      'attendance',
      'decision',
      'interviewerName',
      'remarks',
    ]);
  });

  test('refuses a Recommendation outside the four proposed values', async () => {
    const candidate = await scheduledCandidate();
    const res = await record({
      candidateId: candidate.id,
      scheduledAt: SLOT,
      recommendation: 'Strong hire',
    });

    assert.equal(res.status, 422);
    assert.match(res.body.fields.recommendation, /must be one of/);
  });

  test('saves each Recommendation, reloads it, and can leave it empty', async () => {
    for (const recommendation of [
      'Strongly Recommended',
      'Recommended',
      'Consider',
      'Not Recommended',
    ]) {
      const { id } = await interviewed({ recommendation });
      assert.equal((await view(id)).body.interview.recommendation, recommendation);
    }
    const { id } = await interviewed();
    assert.equal((await view(id)).body.interview.recommendation, null);
  });

  test('changing the Recommendation never changes the decision, scores or stage', async () => {
    const { candidate, id } = await interviewed({ ...ATTENDED, decision: 'selected' });
    const before = await pipelineOf(candidate.id);

    const res = await change(id, { recommendation: 'Not Recommended' });

    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.interview.recommendation, 'Not Recommended');
    assert.equal(res.body.interview.decision, 'selected');
    assert.equal(res.body.interview.totalScore, 40);
    assert.equal(res.body.candidate.stage.code, 'selected');
    assert.deepEqual(await pipelineOf(candidate.id), before);

    const cleared = await change(id, { recommendation: null });
    assert.equal(cleared.body.interview.recommendation, null);
    assert.equal(cleared.body.interview.decision, 'selected');
  });
});

describe('scores', () => {
  test('the total is the sum of the five scores, out of 50', async () => {
    const { body } = await interviewed(ATTENDED);

    assert.equal(body.interview.totalScore, 40);
    assert.equal(body.interview.scoreTechnical, 8);
    assert.equal(body.interview.scoreCultureFit, 10);
  });

  test('the lowest and highest totals are 0 and 50', async () => {
    const all = (n) => ({
      scoreTechnical: n,
      scoreAi: n,
      scoreCommunication: n,
      scoreConfidence: n,
      scoreCultureFit: n,
    });

    assert.equal(
      (await interviewed({ attendance: 'attended', ...all(0) })).body.interview.totalScore,
      0,
    );
    assert.equal(
      (await interviewed({ attendance: 'attended', ...all(10) })).body.interview.totalScore,
      50,
    );
  });

  test('the total follows a changed score', async () => {
    const { id } = await interviewed(ATTENDED);
    const res = await change(id, { scoreConfidence: 9 });

    assert.equal(res.body.interview.totalScore, 43);
  });

  test('a total sent by the browser is ignored', async () => {
    const candidate = await scheduledCandidate();
    const res = await record({
      candidateId: candidate.id,
      ...ATTENDED,
      totalScore: 50,
      total_score: 50,
    });

    assert.equal(res.status, 201);
    assert.equal(res.body.interview.totalScore, 40);
  });

  test('each score must be a whole number from 0 to 10', async () => {
    for (const bad of [-1, 11, 7.5, '7', true]) {
      const candidate = await scheduledCandidate();
      const res = await record({ candidateId: candidate.id, ...ATTENDED, scoreAi: bad });

      assert.equal(res.status, 422, String(bad));
      assert.match(res.body.fields.scoreAi, /whole number from 0 to 10/);
    }
  });

  test('all five scores or none', async () => {
    const candidate = await scheduledCandidate();
    const res = await record({
      candidateId: candidate.id,
      scheduledAt: SLOT,
      attendance: 'attended',
      scoreTechnical: 8,
      scoreAi: 7,
    });

    assert.equal(res.status, 422);
    assert.deepEqual(Object.keys(res.body.fields).sort(), [
      'scoreCommunication',
      'scoreConfidence',
      'scoreCultureFit',
    ]);
  });

  test('the database refuses an out-of-range score, a partial set and a typed total', async () => {
    const candidate = await scheduledCandidate();
    const insert = (columns, values) =>
      db.pool.query(
        `INSERT INTO interviews (candidate_id, scheduled_at, ${columns}) VALUES ($1, now(), ${values})`,
        [candidate.id],
      );

    await assert.rejects(
      insert(
        'score_technical, score_ai, score_communication, score_confidence, score_culture_fit',
        '11, 5, 5, 5, 5',
      ),
      /interviews_score_technical_range/,
    );
    await assert.rejects(
      insert(
        'score_technical, score_ai, score_communication, score_confidence, score_culture_fit',
        '5, 5, 5, 5, -1',
      ),
      /interviews_score_culture_fit_range/,
    );
    await assert.rejects(
      insert('score_technical, score_ai', '5, 5'),
      /interviews_scores_all_or_none/,
    );
    await assert.rejects(insert('total_score', '50'), /generated|total_score/i);
  });

  test('the total column is worked out by the database', async () => {
    const { rows } = await db.pool.query(
      `SELECT is_generated FROM information_schema.columns
        WHERE table_schema = $1 AND table_name = 'interviews' AND column_name = 'total_score'`,
      [db.schema],
    );

    assert.equal(rows[0].is_generated, 'ALWAYS');
  });
});

describe('attendance and the status decision', () => {
  test('a candidate who did not attend cannot be scored or given a status', async () => {
    const candidate = await scheduledCandidate();
    const scored = await record({
      candidateId: candidate.id,
      scheduledAt: SLOT,
      attendance: 'not_attended',
      ...SCORES,
    });
    const decided = await record({
      candidateId: candidate.id,
      scheduledAt: SLOT,
      attendance: 'not_attended',
      decision: 'not_selected',
      rejectReason: 'x',
    });

    assert.equal(scored.status, 422);
    assert.ok(scored.body.fields.scoreTechnical);
    assert.equal(decided.status, 422);
    assert.ok(decided.body.fields.decision);
  });

  test('a status needs attendance and all five scores', async () => {
    const candidate = await scheduledCandidate();
    const noAttendance = await record({
      candidateId: candidate.id,
      scheduledAt: SLOT,
      ...SCORES,
      decision: 'selected',
    });
    const noScores = await record({
      candidateId: candidate.id,
      scheduledAt: SLOT,
      attendance: 'attended',
      decision: 'selected',
    });

    assert.equal(noAttendance.status, 422);
    assert.ok(noAttendance.body.fields.attendance);
    assert.equal(noScores.status, 422);
    assert.ok(noScores.body.fields.decision);
  });

  test('On Hold needs a reason for hold', async () => {
    const candidate = await scheduledCandidate();
    const res = await record({ candidateId: candidate.id, ...ATTENDED, decision: 'on_hold' });

    assert.equal(res.status, 422);
    assert.match(res.body.fields.holdReason, /required/);
    assert.equal((await pipelineOf(candidate.id)).current_stage, 'interview_scheduled');
  });

  test('Not Selected needs a reason for rejection', async () => {
    const candidate = await scheduledCandidate();
    const res = await record({ candidateId: candidate.id, ...ATTENDED, decision: 'not_selected' });

    assert.equal(res.status, 422);
    assert.match(res.body.fields.rejectReason, /required/);
  });

  test('the follow-up date must be a real date', async () => {
    const candidate = await scheduledCandidate();
    const res = await record({
      candidateId: candidate.id,
      ...ATTENDED,
      decision: 'on_hold',
      holdReason: 'Sample',
      nextFollowupDate: '2026-02-30',
    });

    assert.equal(res.status, 422);
    assert.ok(res.body.fields.nextFollowupDate);
  });

  test('the database refuses an unknown status, and a result for an absent candidate', async () => {
    const candidate = await scheduledCandidate();
    const insert = (columns, values) =>
      db.pool.query(
        `INSERT INTO interviews (candidate_id, scheduled_at, ${columns}) VALUES ($1, now(), ${values})`,
        [candidate.id],
      );

    await assert.rejects(insert('decision', `'promoted'`), /interviews_decision_valid/);
    await assert.rejects(insert('attendance', `'late'`), /interviews_attendance_valid/);
    await assert.rejects(
      insert('attendance, decision', `'not_attended', 'selected'`),
      /interviews_absent_has_no_result/,
    );
  });
});

describe('stage changes', () => {
  test('the mapping from interview to stage', () => {
    assert.equal(stageFor({ decision: 'selected', attendance: 'attended' }), 'selected');
    assert.equal(stageFor({ decision: 'not_selected', attendance: 'attended' }), 'rejected');
    assert.equal(stageFor({ decision: 'on_hold', attendance: 'attended' }), 'on_hold');
    assert.equal(stageFor({ decision: null, attendance: 'attended' }), 'interviewed');
    assert.equal(stageFor({ decision: null, attendance: 'not_attended' }), 'not_attended');
    assert.equal(stageFor({ decision: null, attendance: null }), null);
  });

  test('an interview with nothing recorded yet leaves the candidate at Interview Scheduled', async () => {
    const { candidate } = await interviewed();

    assert.equal((await pipelineOf(candidate.id)).current_stage, 'interview_scheduled');
  });

  test('attended with no status yet moves the candidate to Interviewed', async () => {
    const { candidate, body } = await interviewed(ATTENDED);

    assert.equal(body.candidate.stage.code, 'interviewed');
    assert.deepEqual((await historyOf(candidate.id)).slice(-1), [
      'interview_scheduled>interviewed',
    ]);
  });

  test('not attended moves the candidate to Not Attended', async () => {
    const { body } = await interviewed({ attendance: 'not_attended' });

    assert.equal(body.candidate.stage.code, 'not_attended');
  });

  test('Selected moves the candidate to Selected', async () => {
    const { candidate, body } = await interviewed({ ...ATTENDED, decision: 'selected' });

    assert.equal(body.candidate.stage.code, 'selected');
    assert.deepEqual(await historyOf(candidate.id), [
      'none>applied',
      'applied>interview_scheduled',
      'interview_scheduled>selected',
    ]);
  });

  test('Not Selected moves the candidate to Rejected and keeps the reason', async () => {
    const { candidate, body } = await interviewed({
      ...ATTENDED,
      decision: 'not_selected',
      rejectReason: 'Sample rejection reason',
    });

    assert.equal(body.candidate.stage.code, 'rejected');
    assert.equal(body.rejectReason, 'Sample rejection reason');
    assert.deepEqual(await pipelineOf(candidate.id), {
      current_stage: 'rejected',
      hold_reason: null,
      reject_reason: 'Sample rejection reason',
      next_followup_date: null,
    });
  });

  test('On Hold moves the candidate to On Hold with the reason and follow-up date', async () => {
    const { candidate, body } = await interviewed({
      ...ATTENDED,
      decision: 'on_hold',
      holdReason: 'Sample hold reason',
      nextFollowupDate: '2026-11-20',
    });

    assert.equal(body.candidate.stage.code, 'on_hold');
    assert.equal(body.holdReason, 'Sample hold reason');
    assert.equal(body.nextFollowupDate, '2026-11-20');
    assert.deepEqual(await pipelineOf(candidate.id), {
      current_stage: 'on_hold',
      hold_reason: 'Sample hold reason',
      reject_reason: null,
      next_followup_date: '2026-11-20',
    });
  });

  test('On Hold without a follow-up date is allowed', async () => {
    const { candidate } = await interviewed({
      ...ATTENDED,
      decision: 'on_hold',
      holdReason: 'Sample hold reason',
    });

    assert.equal((await pipelineOf(candidate.id)).next_followup_date, null);
  });

  test('each later change adds a history row and records who made it', async () => {
    const { candidate, id } = await interviewed(ATTENDED);
    const other = await signedIn();

    await change(
      id,
      {
        decision: 'on_hold',
        holdReason: 'Waiting for a second opinion',
        nextFollowupDate: '2026-11-20',
      },
      other,
    );
    await change(id, { decision: 'selected' }, other);

    assert.deepEqual(await historyOf(candidate.id), [
      'none>applied',
      'applied>interview_scheduled',
      'interview_scheduled>interviewed',
      'interviewed>on_hold',
      'on_hold>selected',
    ]);
    const { rows } = await db.pool.query(
      'SELECT changed_by, reason FROM stage_history WHERE candidate_id = $1 ORDER BY id DESC LIMIT 2',
      [candidate.id],
    );
    assert.deepEqual(rows, [
      { changed_by: String(other.id), reason: null },
      { changed_by: String(other.id), reason: 'Waiting for a second opinion' },
    ]);
  });

  test('leaving On Hold clears the reason and follow-up date from the current status', async () => {
    const { candidate, id } = await interviewed({
      ...ATTENDED,
      decision: 'on_hold',
      holdReason: 'Sample',
      nextFollowupDate: '2026-11-20',
    });
    await change(id, { decision: 'selected' });

    assert.deepEqual(await pipelineOf(candidate.id), {
      current_stage: 'selected',
      hold_reason: null,
      reject_reason: null,
      next_followup_date: null,
    });
  });

  test('correcting the hold reason or follow-up date keeps the stage and adds no history', async () => {
    const { candidate, id } = await interviewed({
      ...ATTENDED,
      decision: 'on_hold',
      holdReason: 'First wording',
      nextFollowupDate: '2026-11-20',
    });
    const rowsBefore = (await historyOf(candidate.id)).length;

    await change(id, { holdReason: 'Corrected wording', nextFollowupDate: '2026-12-01' });

    const now = await pipelineOf(candidate.id);
    assert.equal(now.hold_reason, 'Corrected wording');
    assert.equal(now.next_followup_date, '2026-12-01');
    assert.equal((await historyOf(candidate.id)).length, rowsBefore);
  });

  test('editing only the remarks does not touch the stage or its history', async () => {
    const { candidate, id } = await interviewed({ ...ATTENDED, decision: 'selected' });
    const rowsBefore = (await historyOf(candidate.id)).length;

    await change(id, { remarks: 'Only the remark changed' });

    assert.equal((await pipelineOf(candidate.id)).current_stage, 'selected');
    assert.equal((await historyOf(candidate.id)).length, rowsBefore);
  });

  test('clearing everything recorded puts the candidate back to Interview Scheduled', async () => {
    const { candidate, id } = await interviewed(ATTENDED);
    const res = await change(id, {
      attendance: null,
      scoreTechnical: null,
      scoreAi: null,
      scoreCommunication: null,
      scoreConfidence: null,
      scoreCultureFit: null,
    });

    assert.equal(res.status, 200);
    assert.equal((await pipelineOf(candidate.id)).current_stage, 'interview_scheduled');
  });

  test('a candidate who has moved further on is not pulled back, and nothing is saved', async () => {
    const { candidate, id } = await interviewed({ ...ATTENDED, decision: 'selected' });
    // A later module has moved the candidate on.
    await db.pool.query(
      `UPDATE pipeline_status SET current_stage = 'offer_sent' WHERE candidate_id = $1`,
      [candidate.id],
    );

    const res = await change(id, { decision: 'not_selected', rejectReason: 'Too late' });

    assert.equal(res.status, 422);
    assert.match(res.body.fields.decision, /already moved on to "Offer Sent"/);
    assert.equal((await pipelineOf(candidate.id)).current_stage, 'offer_sent');
    assert.equal((await view(id)).body.interview.decision, 'selected');
  });
});

describe('the phone interview after a direct interview exists', () => {
  test('its result can no longer move the candidate', async () => {
    const { candidate } = await interviewed({
      ...ATTENDED,
      decision: 'not_selected',
      rejectReason: 'Rejected at interview',
    });
    const phone = (
      await api(`/candidates/${candidate.id}/phone-interview`, { cookie: admin.cookie })
    ).body.phoneScreen;

    const res = await api(`/phone-interviews/${phone.id}`, {
      method: 'PATCH',
      cookie: admin.cookie,
      body: { result: null, interviewAt: null },
    });

    assert.equal(res.status, 422);
    assert.match(res.body.fields.result, /direct interview has been recorded/);
    assert.deepEqual(await pipelineOf(candidate.id), {
      current_stage: 'rejected',
      hold_reason: null,
      reject_reason: 'Rejected at interview',
      next_followup_date: null,
    });
  });

  // Found in a real browser run: after a rejection at the direct interview,
  // the phone result could be switched to Not Selected, because both end in
  // the same stage name. The phone record then contradicted the interview.
  test('its result cannot be changed even when the stage name would stay the same', async () => {
    const { candidate } = await interviewed({
      ...ATTENDED,
      decision: 'not_selected',
      rejectReason: 'Rejected at interview',
    });
    const phone = (
      await api(`/candidates/${candidate.id}/phone-interview`, { cookie: admin.cookie })
    ).body.phoneScreen;

    const res = await api(`/phone-interviews/${phone.id}`, {
      method: 'PATCH',
      cookie: admin.cookie,
      body: { result: 'not_selected', interviewAt: null, rejectReason: 'Changed afterwards' },
    });

    assert.equal(res.status, 422);
    assert.match(res.body.fields.result, /direct interview has been recorded/);
    const after = (
      await api(`/candidates/${candidate.id}/phone-interview`, { cookie: admin.cookie })
    ).body;
    assert.equal(after.phoneScreen.result, 'selected');
    assert.equal(after.rejectReason, 'Rejected at interview');
  });

  test('its review can still be edited', async () => {
    const { candidate } = await interviewed(ATTENDED);
    const phone = (
      await api(`/candidates/${candidate.id}/phone-interview`, { cookie: admin.cookie })
    ).body.phoneScreen;

    const res = await api(`/phone-interviews/${phone.id}`, {
      method: 'PATCH',
      cookie: admin.cookie,
      body: { review: 'Added afterwards' },
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.candidate.stage.code, 'interviewed');
  });
});

describe('changing and viewing an interview', () => {
  test('changes only the fields that were sent', async () => {
    const { id } = await interviewed({ ...ATTENDED, interviewerName: 'Sample Interviewer' });
    const res = await change(id, { remarks: 'Added remark' });

    assert.equal(res.status, 200);
    assert.equal(res.body.interview.remarks, 'Added remark');
    assert.equal(res.body.interview.interviewerName, 'Sample Interviewer');
    assert.equal(res.body.interview.totalScore, 40);
  });

  test('validates the change', async () => {
    const { id } = await interviewed(ATTENDED);
    const res = await change(id, { scoreAi: 12 });

    assert.equal(res.status, 422);
    assert.ok(res.body.fields.scoreAi);
    assert.equal((await view(id)).body.interview.scoreAi, 7);
  });

  test('returns the full record with the candidate and the resulting stage', async () => {
    const { id, candidate } = await interviewed({
      ...ATTENDED,
      decision: 'selected',
      remarks: 'Sample remark',
    });
    const res = await view(id);

    assert.equal(res.status, 200);
    assert.equal(res.body.candidate.candidateCode, candidate.candidateCode);
    assert.equal(res.body.candidate.stage.name, 'Selected');
    assert.equal(res.body.interview.decision, 'selected');
    assert.equal(res.body.interview.totalScore, 40);
    assert.equal(res.body.interview.updatedBy, 'Test User');
  });

  test('answers "not found" for an unknown or malformed id', async () => {
    assert.equal((await view(999999)).status, 404);
    assert.equal((await view('abc')).status, 404);
    assert.equal((await change(999999, { remarks: 'x' })).status, 404);
  });
});

describe('listing', () => {
  let listed;

  before(async () => {
    listed = {
      waiting: await scheduledCandidate({ fullName: 'Wombat Waiting', candidateCode: 'IVL-WAIT' }),
      selected: await scheduledCandidate({ fullName: 'Wombat Selected' }),
      held: await scheduledCandidate({ fullName: 'Wombat Held' }),
      absent: await scheduledCandidate({ fullName: 'Wombat Absent' }),
      notReady: await appliedCandidate({ fullName: 'Wombat Not Ready' }),
    };
    await record({
      candidateId: listed.selected.id,
      ...ATTENDED,
      decision: 'selected',
      interviewerName: 'Sample Interviewer',
    });
    await record({
      candidateId: listed.held.id,
      ...ATTENDED,
      decision: 'on_hold',
      holdReason: 'Sample',
    });
    await record({ candidateId: listed.absent.id, scheduledAt: SLOT, attendance: 'not_attended' });
  });

  const list = (query = '') => api(`/interviews${query}`, { cookie: admin.cookie });
  const names = (res) => res.body.items.map((item) => item.candidate.fullName).sort();

  test('shows candidates with an interview and those waiting for one, but nobody else', async () => {
    assert.deepEqual(names(await list('?search=Wombat')), [
      'Wombat Absent',
      'Wombat Held',
      'Wombat Selected',
      'Wombat Waiting',
    ]);
  });

  test('a waiting candidate has no interview yet, but shows the slot from the phone interview', async () => {
    const res = await list('?search=Wombat%20Waiting');
    const item = res.body.items[0];

    assert.equal(item.interview, null);
    assert.equal(item.plannedAt, '2026-11-02T04:30:00.000Z');
    assert.equal(item.candidate.stage.name, 'Interview Scheduled');
  });

  test('returns only the fields the list screen needs', async () => {
    const item = (await list('?search=Wombat%20Selected')).body.items[0];

    assert.deepEqual(Object.keys(item).sort(), ['candidate', 'interview', 'plannedAt']);
    assert.deepEqual(Object.keys(item.candidate).sort(), [
      'candidateCode',
      'companyCvPending',
      'companyCvStatus',
      'companyCvUrl',
      'fullName',
      'id',
      'stage',
    ]);
    assert.deepEqual(Object.keys(item.interview).sort(), [
      'attendance',
      'decision',
      'id',
      'interviewerName',
      'recommendation',
      'scheduledAt',
      'totalScore',
    ]);
    assert.equal(item.interview.totalScore, 40);
    assert.equal(item.interview.interviewerName, 'Sample Interviewer');
  });

  test('searches by name and Candidate ID', async () => {
    assert.deepEqual(names(await list('?search=wombat%20held')), ['Wombat Held']);
    assert.deepEqual(names(await list('?search=ivl-wait')), ['Wombat Waiting']);
  });

  test('filters by status, including "not decided yet"', async () => {
    assert.deepEqual(names(await list('?search=Wombat&decision=selected')), ['Wombat Selected']);
    assert.deepEqual(names(await list('?search=Wombat&decision=on_hold')), ['Wombat Held']);
    assert.deepEqual(names(await list('?search=Wombat&decision=pending')), [
      'Wombat Absent',
      'Wombat Waiting',
    ]);
  });

  test('filters by attendance', async () => {
    assert.deepEqual(names(await list('?search=Wombat&attendance=attended')), [
      'Wombat Held',
      'Wombat Selected',
    ]);
    assert.deepEqual(names(await list('?search=Wombat&attendance=not_attended')), [
      'Wombat Absent',
    ]);
    assert.deepEqual(names(await list('?search=Wombat&attendance=pending')), ['Wombat Waiting']);
  });

  test('pages through the results and caps the page size', async () => {
    const first = await list('?search=Wombat&pageSize=3&page=1');
    const second = await list('?search=Wombat&pageSize=3&page=2');

    assert.equal(first.body.total, 4);
    assert.equal(first.body.items.length, 3);
    assert.equal(second.body.items.length, 1);
    assert.equal((await list('?pageSize=9999')).body.pageSize, 100);
  });

  test('ignores an unknown filter value', async () => {
    assert.equal(
      (await list(`?search=Wombat&decision=${encodeURIComponent("x' OR 1=1")}`)).body.total,
      4,
    );
  });
});

describe('audit log', () => {
  test('recording with a status writes the create and the stage change', async () => {
    const { candidate, id } = await interviewed({ ...ATTENDED, decision: 'selected' });

    assert.deepEqual(await auditActions(candidate.id, id), [
      'INTERVIEW_CREATE',
      'PIPELINE_STAGE_CHANGE',
    ]);
  });

  test('the stage change row says who, from what, to what and why', async () => {
    const { candidate } = await interviewed({
      ...ATTENDED,
      decision: 'on_hold',
      holdReason: 'Sample audit reason',
    });
    const { rows } = await db.pool.query(
      `SELECT actor_user_id, old_values, new_values, details FROM audit_log
        WHERE action = 'PIPELINE_STAGE_CHANGE' AND entity_id = $1 AND details->>'source' = 'direct_interview'`,
      [candidate.id],
    );

    assert.equal(rows[0].actor_user_id, String(admin.id));
    assert.deepEqual(rows[0].old_values, { stage: 'interview_scheduled' });
    assert.deepEqual(rows[0].new_values, { stage: 'on_hold' });
    assert.deepEqual(rows[0].details, {
      source: 'direct_interview',
      reason: 'Sample audit reason',
    });
  });

  test('an edit records only the fields that changed', async () => {
    const { id } = await interviewed(ATTENDED);
    await change(id, { scoreAi: 9 });
    const { rows } = await db.pool.query(
      `SELECT old_values, new_values FROM audit_log WHERE action = 'INTERVIEW_UPDATE' AND entity_id = $1`,
      [id],
    );

    assert.deepEqual(rows[0].old_values, { scoreAi: 7 });
    assert.deepEqual(rows[0].new_values, { scoreAi: 9 });
  });

  test('an edit that changes nothing, and a refused save, record nothing', async () => {
    const { candidate, id } = await interviewed(ATTENDED);
    const before = await auditActions(candidate.id, id);

    await change(id, { scoreAi: 7 });
    await change(id, { scoreAi: 99 });

    assert.deepEqual(await auditActions(candidate.id, id), before);
  });
});
