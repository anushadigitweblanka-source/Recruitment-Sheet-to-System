import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { createApp } from '../src/app.js';
import { createTestDatabase, createTestUser } from './helpers/testDb.js';

// The acceptance checklist's automatic offer: a direct interview saved with
// decision "Selected" creates exactly one offer row, in the same transaction
// as the stage change. A real server and real tables in a throwaway schema;
// every name and phone number below is made up.

let db;
let server;
let baseUrl;
let admin;
let position;
let nextCode = 1;

const SLOT = '2026-11-02T10:00:00+05:30';
const ATTENDED_INTERVIEW = {
  scheduledAt: SLOT,
  attendance: 'attended',
  scoreTechnical: 8,
  scoreAi: 7,
  scoreCommunication: 9,
  scoreConfidence: 6,
  scoreCultureFit: 10,
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

async function signedIn() {
  const user = await createTestUser(db.pool);
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: user.email, password: user.password }),
  });
  return { ...user, cookie: res.headers.get('set-cookie').split(';')[0] };
}

// A fictional candidate taken through Module 2 to "Interview Scheduled".
// withPosition: whether they applied for a position (it is optional).
async function scheduledCandidate({ withPosition = true } = {}) {
  const n = nextCode;
  nextCode += 1;
  const created = await api('/candidates', {
    method: 'POST',
    cookie: admin.cookie,
    body: {
      candidateCode: `AUTO-OFFER-TEST-${String(n).padStart(3, '0')}`,
      fullName: `Auto Offer Sample ${n}`,
      phone: `07411${String(n).padStart(5, '0')}`,
      ...(withPosition ? { positionId: position.id } : {}),
    },
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const candidate = created.body.candidate;
  const phone = await api('/phone-interviews', {
    method: 'POST',
    cookie: admin.cookie,
    body: { candidateId: candidate.id, called: true, result: 'selected', interviewAt: SLOT },
  });
  assert.equal(phone.status, 201, JSON.stringify(phone.body));
  return candidate;
}

const recordInterview = (body) =>
  api('/interviews', { method: 'POST', body, cookie: admin.cookie });
const changeInterview = (id, body) =>
  api(`/interviews/${id}`, { method: 'PATCH', body, cookie: admin.cookie });

const offersOf = async (candidateId) =>
  (await db.pool.query('SELECT * FROM offers WHERE candidate_id = $1 ORDER BY id', [candidateId]))
    .rows;
const stageOf = async (candidateId) =>
  (
    await db.pool.query('SELECT current_stage FROM pipeline_status WHERE candidate_id = $1', [
      candidateId,
    ])
  ).rows[0].current_stage;

before(async () => {
  db = await createTestDatabase();
  server = createApp({ config: db.config, pool: db.pool }).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  admin = await signedIn();
  const res = await api('/lookups/positions', {
    method: 'POST',
    cookie: admin.cookie,
    body: { name: 'Auto Offer Test Position' },
  });
  position = res.body.item;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await db.cleanup();
});

describe('selected creates the offer automatically', () => {
  test('one offer row, for the right candidate, with only the known values', async () => {
    const candidate = await scheduledCandidate();
    const res = await recordInterview({
      candidateId: candidate.id,
      ...ATTENDED_INTERVIEW,
      decision: 'selected',
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));

    const offers = await offersOf(candidate.id);
    assert.equal(offers.length, 1, 'exactly one offer');
    const offer = offers[0];
    assert.equal(Number(offer.candidate_id), candidate.id, 'the right candidate');
    assert.equal(
      Number(offer.position_id),
      position.id,
      'the applied position, not an invented one',
    );
    // Nothing is invented: every other business field stays empty.
    assert.equal(offer.offer_date, null);
    assert.equal(offer.work_mode, null);
    assert.equal(offer.location, null);
    assert.equal(offer.offer_status, null);
    assert.equal(offer.onboarding_date, null);
    assert.equal(offer.attended, null);
    // No salary column exists on the row at all.
    assert.ok(!Object.keys(offer).some((name) => name.includes('salary')), 'no salary anywhere');

    assert.equal(await stageOf(candidate.id), 'selected', 'pipeline stays at Selected');

    const audit = await db.pool.query(
      `SELECT new_values, details FROM audit_log
        WHERE action = 'OFFER_CREATE' AND entity_type = 'offers' AND entity_id = $1`,
      [offer.id],
    );
    assert.equal(audit.rows.length, 1, 'the automatic offer is audited');
    assert.equal(audit.rows[0].details.source, 'direct_interview');
    assert.ok(!JSON.stringify(audit.rows[0]).includes('salary'), 'no salary in the audit');
  });

  test('the offer appears in the offer list with the applied position', async () => {
    const candidate = await scheduledCandidate();
    await recordInterview({
      candidateId: candidate.id,
      ...ATTENDED_INTERVIEW,
      decision: 'selected',
    });

    const list = await api(`/offers?search=${candidate.candidateCode}`, { cookie: admin.cookie });
    assert.equal(list.status, 200);
    assert.equal(list.body.items.length, 1);
    const item = list.body.items[0];
    assert.equal(item.candidate.id, candidate.id);
    assert.ok(item.offer, 'the row carries the automatic offer');
    assert.equal(item.offer.position, 'Auto Offer Test Position');
    assert.equal(item.offer.offerStatus, null, 'not sent yet');
  });

  test('a decision reached later, by editing the interview, also creates the offer', async () => {
    const candidate = await scheduledCandidate();
    const recorded = await recordInterview({ candidateId: candidate.id, ...ATTENDED_INTERVIEW });
    assert.equal(recorded.status, 201);
    assert.equal((await offersOf(candidate.id)).length, 0, 'no decision, no offer');

    const res = await changeInterview(recorded.body.interview.id, { decision: 'selected' });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal((await offersOf(candidate.id)).length, 1);
    assert.equal(await stageOf(candidate.id), 'selected');
  });
});

describe('duplicate protection', () => {
  test('saving Selected again, editing scores and retrying never add a second offer', async () => {
    const candidate = await scheduledCandidate();
    const recorded = await recordInterview({
      candidateId: candidate.id,
      ...ATTENDED_INTERVIEW,
      decision: 'selected',
    });
    const interviewId = recorded.body.interview.id;
    assert.equal((await offersOf(candidate.id)).length, 1);

    // The same decision saved again (a request retry sends the same PATCH).
    const again = await changeInterview(interviewId, { decision: 'selected' });
    assert.equal(again.status, 200);
    const retried = await changeInterview(interviewId, { decision: 'selected' });
    assert.equal(retried.status, 200);
    // A score corrected later.
    const scored = await changeInterview(interviewId, { scoreTechnical: 9 });
    assert.equal(scored.status, 200);

    assert.equal((await offersOf(candidate.id)).length, 1, 'still exactly one offer');

    // Recording the interview itself a second time is refused outright.
    const second = await recordInterview({
      candidateId: candidate.id,
      ...ATTENDED_INTERVIEW,
      decision: 'selected',
    });
    assert.equal(second.status, 409);
    assert.equal((await offersOf(candidate.id)).length, 1);
  });

  test('a manual offer for the same candidate is refused as already existing', async () => {
    const candidate = await scheduledCandidate();
    await recordInterview({
      candidateId: candidate.id,
      ...ATTENDED_INTERVIEW,
      decision: 'selected',
    });

    const manual = await api('/offers', {
      method: 'POST',
      cookie: admin.cookie,
      body: { candidateId: candidate.id, positionId: position.id },
    });
    assert.equal(manual.status, 409, JSON.stringify(manual.body));
    assert.equal((await offersOf(candidate.id)).length, 1);
  });
});

describe('rollback safety', () => {
  test('a refused interview change after the automatic offer rolls back completely', async () => {
    const candidate = await scheduledCandidate();
    const recorded = await recordInterview({
      candidateId: candidate.id,
      ...ATTENDED_INTERVIEW,
      decision: 'selected',
    });
    const interviewId = recorded.body.interview.id;

    // The offer exists, so moving the decision away must be refused - and the
    // decision column, written inside the same transaction before the refusal,
    // must be rolled back with it. The offer is never deleted automatically.
    const res = await changeInterview(interviewId, {
      decision: 'not_selected',
      rejectReason: 'Changed my mind',
    });
    assert.equal(res.status, 422);

    const row = await db.pool.query('SELECT decision FROM interviews WHERE id = $1', [interviewId]);
    assert.equal(row.rows[0].decision, 'selected', 'the interview is unchanged');
    assert.equal((await offersOf(candidate.id)).length, 1, 'the offer is still there');
    assert.equal(await stageOf(candidate.id), 'selected', 'the stage is unchanged');
  });
});

describe('candidate without an applied position', () => {
  test('Selected still works; the candidate waits in the offer tracker instead', async () => {
    const candidate = await scheduledCandidate({ withPosition: false });
    const res = await recordInterview({
      candidateId: candidate.id,
      ...ATTENDED_INTERVIEW,
      decision: 'selected',
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));

    assert.equal((await offersOf(candidate.id)).length, 0, 'nothing invented for the position');
    assert.equal(await stageOf(candidate.id), 'selected');

    // They appear as waiting in the offer list, for a manual offer.
    const list = await api(`/offers?search=${candidate.candidateCode}&waiting=true`, {
      cookie: admin.cookie,
    });
    assert.equal(list.body.items.length, 1);
    assert.equal(list.body.items[0].offer, null);
  });
});
