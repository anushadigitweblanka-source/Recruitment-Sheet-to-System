import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { createApp } from '../src/app.js';
import { stageFor } from '../src/modules/offers/offers.service.js';
import { createTestDatabase, createTestRole, createTestUser } from './helpers/testDb.js';

// Integration tests: a real server and real tables, in a throwaway schema.
// Every name and phone number below is made up.

let db;
let server;
let baseUrl;
let admin; // holds every permission
let viewer; // may view candidates, cannot manage offers
let outsider; // holds no permission
let position; // an approved position
let otherPosition;
let retiredPosition; // switched off
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

async function signedIn(options) {
  const user = await createTestUser(db.pool, options);
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: user.email, password: user.password }),
  });
  return { ...user, cookie: res.headers.get('set-cookie').split(';')[0] };
}

async function newPosition(name) {
  const res = await api('/lookups/positions', {
    method: 'POST',
    cookie: admin.cookie,
    body: { name },
  });
  return res.body.item;
}

// A candidate as Module 1 creates them: at "Applied".
async function appliedCandidate(overrides = {}) {
  const n = nextCode;
  nextCode += 1;
  const res = await api('/candidates', {
    method: 'POST',
    cookie: admin.cookie,
    body: {
      candidateCode: `OF-${String(n).padStart(4, '0')}`,
      fullName: `Offer Sample ${n}`,
      phone: `07400${String(n).padStart(5, '0')}`,
      ...overrides,
    },
  });
  return res.body.candidate;
}

// A candidate taken through Modules 2 and 3 to the given direct interview result.
async function interviewedCandidate(interview, overrides) {
  const candidate = await appliedCandidate(overrides);
  await api('/phone-interviews', {
    method: 'POST',
    cookie: admin.cookie,
    body: { candidateId: candidate.id, called: true, result: 'selected', interviewAt: SLOT },
  });
  const res = await api('/interviews', {
    method: 'POST',
    cookie: admin.cookie,
    body: { candidateId: candidate.id, ...interview },
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return { ...candidate, interviewId: res.body.interview.id };
}

const selectedCandidate = (overrides) =>
  interviewedCandidate({ ...ATTENDED_INTERVIEW, decision: 'selected' }, overrides);

const create = (body, who = admin) => api('/offers', { method: 'POST', body, cookie: who.cookie });
const change = (id, body, who = admin) =>
  api(`/offers/${id}`, { method: 'PATCH', body, cookie: who.cookie });
const view = (id, who = admin) => api(`/offers/${id}`, { cookie: who.cookie });

// Creates an offer for a fresh, selected candidate.
async function offered(body = {}, overrides) {
  const candidate = await selectedCandidate(overrides);
  const res = await create({ candidateId: candidate.id, positionId: position.id, ...body });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return { candidate, id: res.body.offer.id, body: res.body };
}

const stageOf = async (candidateId) =>
  (
    await db.pool.query('SELECT current_stage FROM pipeline_status WHERE candidate_id = $1', [
      candidateId,
    ])
  ).rows[0].current_stage;
const historyOf = async (candidateId) =>
  (
    await db.pool.query(
      'SELECT from_stage, to_stage FROM stage_history WHERE candidate_id = $1 ORDER BY id',
      [candidateId],
    )
  ).rows.map((row) => `${row.from_stage ?? 'none'}>${row.to_stage}`);
const auditActions = async (candidateId, offerId) =>
  (
    await db.pool.query(
      `SELECT action FROM audit_log
        WHERE (entity_type = 'offers' AND entity_id = $2)
           OR (entity_type = 'candidates' AND entity_id = $1 AND action = 'PIPELINE_STAGE_CHANGE'
               AND details->>'source' = 'offer')
        ORDER BY id`,
      [candidateId, offerId],
    )
  ).rows.map((row) => row.action);
const offerCount = async (candidateId) =>
  (
    await db.pool.query('SELECT count(*)::int AS n FROM offers WHERE candidate_id = $1', [
      candidateId,
    ])
  ).rows[0].n;

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

  position = await newPosition('Sample Position A');
  otherPosition = await newPosition('Sample Position B');
  retiredPosition = await newPosition('Sample Position Retired');
  await db.pool.query('UPDATE positions SET is_active = false WHERE id = $1', [retiredPosition.id]);
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await db.cleanup();
});

describe('access', () => {
  test('every route refuses a visitor who is not signed in', async () => {
    assert.equal((await api('/offers')).status, 401);
    assert.equal((await api('/offers/1')).status, 401);
    assert.equal((await api('/offers', { method: 'POST', body: { candidateId: 1 } })).status, 401);
    assert.equal((await api('/offers/1', { method: 'PATCH', body: {} })).status, 401);
  });

  test('a user with no permission is refused', async () => {
    assert.equal((await api('/offers', { cookie: outsider.cookie })).status, 403);
    assert.equal((await api('/offers/1', { cookie: outsider.cookie })).status, 403);
  });

  test('a view-only user can read but cannot create or change', async () => {
    const { id } = await offered();
    const waiting = await selectedCandidate();

    assert.equal((await api('/offers', { cookie: viewer.cookie })).status, 200);
    assert.equal((await view(id, viewer)).status, 200);
    assert.equal(
      (await create({ candidateId: waiting.id, positionId: position.id }, viewer)).status,
      403,
    );
    assert.equal((await change(id, { location: 'x' }, viewer)).status, 403);
    assert.equal(await offerCount(waiting.id), 0);
  });
});

describe('creating an offer', () => {
  test('saves it and returns it with the candidate', async () => {
    const candidate = await selectedCandidate();
    const res = await create({
      candidateId: candidate.id,
      positionId: position.id,
      offerDate: '2026-11-05',
      location: '  Sample Office ',
    });

    assert.equal(res.status, 201);
    assert.equal(res.body.candidate.id, candidate.id);
    assert.equal(res.body.candidate.candidateCode, candidate.candidateCode);
    assert.equal(res.body.offer.positionId, position.id);
    assert.equal(res.body.offer.position, 'Sample Position A');
    assert.equal(res.body.offer.offerDate, '2026-11-05');
    assert.equal(res.body.offer.location, 'Sample Office');
    assert.equal(res.body.offer.workMode, null);
    assert.equal(res.body.offer.offerStatus, null);
    assert.equal(res.body.offer.onboardingDate, null);
    assert.equal(res.body.offer.attended, null);
    assert.equal(res.body.offer.updatedBy, 'Test User');
  });

  test('only the position is required', async () => {
    const { body } = await offered();

    assert.equal(body.offer.offerDate, null);
    assert.equal(body.offer.location, null);
  });

  test('refuses a candidate that does not exist, or none at all', async () => {
    const missing = await create({ candidateId: 999999, positionId: position.id });

    assert.equal(missing.status, 422);
    assert.match(missing.body.fields.candidateId, /does not exist/);
    assert.equal((await create({ positionId: position.id })).status, 422);
    assert.equal((await create({ candidateId: 'abc', positionId: position.id })).status, 422);
  });

  test('a second offer for the same candidate is refused, pointing to the first', async () => {
    const { candidate, id } = await offered();
    const res = await create({ candidateId: candidate.id, positionId: position.id });

    assert.equal(res.status, 409);
    assert.equal(res.body.error, 'already_exists');
    assert.equal(res.body.offerId, id);
    assert.equal(await offerCount(candidate.id), 1);
  });
});

describe('candidate eligibility', () => {
  const refused = async (candidate, stageName) => {
    const res = await create({ candidateId: candidate.id, positionId: position.id });

    assert.equal(res.status, 422, stageName);
    assert.match(res.body.fields.candidateId, new RegExp(`This candidate is at "${stageName}"`));
    assert.equal(await offerCount(candidate.id), 0);
  };

  test('a candidate who has only applied cannot receive an offer', async () => {
    await refused(await appliedCandidate(), 'Applied');
  });

  test('a candidate interviewed but not decided cannot receive an offer', async () => {
    await refused(await interviewedCandidate(ATTENDED_INTERVIEW), 'Interviewed');
  });

  test('a rejected candidate cannot receive an offer', async () => {
    await refused(
      await interviewedCandidate({
        ...ATTENDED_INTERVIEW,
        decision: 'not_selected',
        rejectReason: 'Sample rejection reason',
      }),
      'Rejected',
    );
  });

  test('a candidate on hold cannot receive an offer', async () => {
    await refused(
      await interviewedCandidate({
        ...ATTENDED_INTERVIEW,
        decision: 'on_hold',
        holdReason: 'Sample hold reason',
      }),
      'On Hold',
    );
  });

  test('a candidate who did not attend the interview cannot receive an offer', async () => {
    await refused(
      await interviewedCandidate({ scheduledAt: SLOT, attendance: 'not_attended' }),
      'Not Attended',
    );
  });
});

describe('validation', () => {
  test('the position is required and must be a whole number', async () => {
    const candidate = await selectedCandidate();

    for (const positionId of [undefined, null, '', '3', 2.5, 0]) {
      const res = await create({ candidateId: candidate.id, positionId });
      assert.equal(res.status, 422, String(positionId));
      assert.ok(res.body.fields.positionId);
    }
  });

  test('the position must exist and be in use', async () => {
    const candidate = await selectedCandidate();
    const unknown = await create({ candidateId: candidate.id, positionId: 999999 });
    const retired = await create({ candidateId: candidate.id, positionId: retiredPosition.id });

    assert.equal(unknown.status, 422);
    assert.match(unknown.body.fields.positionId, /does not exist/);
    assert.equal(retired.status, 422);
    assert.match(retired.body.fields.positionId, /no longer in use/);
    assert.equal(await offerCount(candidate.id), 0);
  });

  test('dates must be real calendar dates', async () => {
    const candidate = await selectedCandidate();
    const res = await create({
      candidateId: candidate.id,
      positionId: position.id,
      offerDate: '05/11/2026',
      onboardingDate: '2026-02-30',
    });

    assert.equal(res.status, 422);
    assert.deepEqual(Object.keys(res.body.fields).sort(), ['offerDate', 'onboardingDate']);
  });

  test('reports badly formed values field by field', async () => {
    const candidate = await selectedCandidate();
    const res = await create({
      candidateId: candidate.id,
      positionId: position.id,
      location: 'x'.repeat(201),
      offerStatus: 'pending',
      attended: 'yes',
    });

    assert.equal(res.status, 422);
    assert.deepEqual(Object.keys(res.body.fields).sort(), ['attended', 'location', 'offerStatus']);
  });

  test('only Sent and Accepted are offer statuses; no other value is accepted', async () => {
    const candidate = await selectedCandidate();

    for (const offerStatus of ['draft', 'pending', 'rejected', 'Sent']) {
      const res = await create({ candidateId: candidate.id, positionId: position.id, offerStatus });
      assert.equal(res.status, 422, offerStatus);
      assert.match(res.body.fields.offerStatus, /Sent or Accepted/);
    }
  });

  test('accepts Office as the Work Mode and returns it on later reads', async () => {
    const { id, body } = await offered({ workMode: 'office' });

    assert.equal(body.offer.workMode, 'office');
    assert.equal((await view(id)).body.offer.workMode, 'office');
  });

  test('only Office is a Work Mode; no other value is accepted', async () => {
    const candidate = await selectedCandidate();

    for (const workMode of ['Remote', 'remote', 'hybrid', 'Office']) {
      const res = await create({ candidateId: candidate.id, positionId: position.id, workMode });
      assert.equal(res.status, 422, workMode);
      assert.match(res.body.fields.workMode, /must be Office/);
    }
    assert.equal(await offerCount(candidate.id), 0);
  });

  test('attendance needs an onboarding date and an accepted offer', async () => {
    const candidate = await selectedCandidate();
    const noDate = await create({
      candidateId: candidate.id,
      positionId: position.id,
      offerStatus: 'accepted',
      attended: true,
    });
    const notAccepted = await create({
      candidateId: candidate.id,
      positionId: position.id,
      offerStatus: 'sent',
      onboardingDate: '2026-11-16',
      attended: true,
    });

    assert.equal(noDate.status, 422);
    assert.match(noDate.body.fields.onboardingDate, /before recording attendance/);
    assert.equal(notAccepted.status, 422);
    assert.match(notAccepted.body.fields.attended, /Accepted/);
    assert.equal(await stageOf(candidate.id), 'selected');
  });

  test('the database refuses an unknown status and attendance without its conditions', async () => {
    const candidate = await selectedCandidate();
    const insert = (columns, values) =>
      db.pool.query(
        `INSERT INTO offers (candidate_id, position_id, ${columns}) VALUES ($1, $2, ${values})`,
        [candidate.id, position.id],
      );

    await assert.rejects(insert('offer_status', `'rejected'`), /offers_offer_status_valid/);
    await assert.rejects(insert('work_mode', `'Remote'`), /offers_work_mode_valid/);
    await assert.rejects(
      insert('attended', 'true'),
      /offers_attended_needs_accepted_and_date/,
      'no status and no date',
    );
    await assert.rejects(
      insert('offer_status, attended', `'accepted', true`),
      /offers_attended_needs_accepted_and_date/,
      'no date',
    );
    await assert.rejects(
      insert('offer_status, onboarding_date, attended', `'sent', '2026-11-16', false`),
      /offers_attended_needs_accepted_and_date/,
      'not accepted',
    );
    await assert.rejects(
      db.pool.query('INSERT INTO offers (candidate_id, position_id) VALUES (999999, $1)', [
        position.id,
      ]),
      /offers_candidate_id_fkey/,
    );
  });
});

describe('stage changes', () => {
  test('the mapping from offer to stage', () => {
    assert.equal(stageFor({ offerStatus: null, attended: null }), null);
    assert.equal(stageFor({ offerStatus: 'sent', attended: null }), 'offer_sent');
    assert.equal(stageFor({ offerStatus: 'accepted', attended: null }), 'offer_accepted');
    assert.equal(stageFor({ offerStatus: 'accepted', attended: false }), 'offer_accepted');
    assert.equal(stageFor({ offerStatus: 'accepted', attended: true }), 'joined');
  });

  test('an offer with no status yet leaves the candidate at Selected', async () => {
    const { candidate, body } = await offered({ offerDate: '2026-11-05' });

    assert.equal(body.candidate.stage.code, 'selected');
    assert.equal((await historyOf(candidate.id)).at(-1), 'interview_scheduled>selected');
  });

  test('Sent moves the candidate to Offer Sent', async () => {
    const { candidate, id } = await offered();
    const res = await change(id, { offerStatus: 'sent' });

    assert.equal(res.status, 200);
    assert.equal(res.body.candidate.stage.name, 'Offer Sent');
    assert.equal(await stageOf(candidate.id), 'offer_sent');
  });

  test('Accepted moves the candidate to Offer Accepted', async () => {
    const { candidate, id } = await offered({ offerStatus: 'sent' });
    const res = await change(id, { offerStatus: 'accepted' });

    assert.equal(res.body.candidate.stage.name, 'Offer Accepted');
    assert.equal(await stageOf(candidate.id), 'offer_accepted');
  });

  test('an onboarding date alone does not change the stage', async () => {
    const { candidate, id } = await offered({ offerStatus: 'accepted' });
    const rowsBefore = (await historyOf(candidate.id)).length;
    const res = await change(id, { onboardingDate: '2026-11-16' });

    assert.equal(res.body.offer.onboardingDate, '2026-11-16');
    assert.equal(await stageOf(candidate.id), 'offer_accepted');
    assert.equal((await historyOf(candidate.id)).length, rowsBefore);
  });

  test('Attended = Yes on the onboarding date moves the candidate to Joined', async () => {
    const { candidate, id } = await offered({
      offerStatus: 'accepted',
      onboardingDate: '2026-11-16',
    });
    const res = await change(id, { attended: true });

    assert.equal(res.status, 200);
    assert.equal(res.body.offer.attended, true);
    assert.equal(res.body.candidate.stage.name, 'Joined');
    assert.deepEqual(await historyOf(candidate.id), [
      'none>applied',
      'applied>interview_scheduled',
      'interview_scheduled>selected',
      'selected>offer_accepted',
      'offer_accepted>joined',
    ]);
  });

  test('Attended = No is recorded and leaves the candidate at Offer Accepted', async () => {
    const { candidate, id } = await offered({
      offerStatus: 'accepted',
      onboardingDate: '2026-11-16',
    });
    const res = await change(id, { attended: false });

    assert.equal(res.status, 200);
    assert.equal(res.body.offer.attended, false);
    assert.equal(await stageOf(candidate.id), 'offer_accepted');
  });

  test('each change adds a history row and records who made it', async () => {
    const { candidate, id } = await offered();
    const other = await signedIn();

    await change(id, { offerStatus: 'sent' }, other);
    await change(id, { offerStatus: 'accepted' }, other);

    assert.deepEqual((await historyOf(candidate.id)).slice(-2), [
      'selected>offer_sent',
      'offer_sent>offer_accepted',
    ]);
    const { rows } = await db.pool.query(
      'SELECT changed_by FROM stage_history WHERE candidate_id = $1 ORDER BY id DESC LIMIT 2',
      [candidate.id],
    );
    assert.deepEqual(rows, [{ changed_by: String(other.id) }, { changed_by: String(other.id) }]);
  });

  test('correcting a status adds history rather than rewriting it', async () => {
    const { candidate, id } = await offered({ offerStatus: 'accepted' });

    await change(id, { offerStatus: 'sent' });
    await change(id, { offerStatus: null });

    assert.equal(await stageOf(candidate.id), 'selected');
    assert.deepEqual((await historyOf(candidate.id)).slice(-3), [
      'selected>offer_accepted',
      'offer_accepted>offer_sent',
      'offer_sent>selected',
    ]);
  });

  test('editing only the location does not touch the stage or its history', async () => {
    const { candidate, id } = await offered({ offerStatus: 'sent' });
    const rowsBefore = (await historyOf(candidate.id)).length;

    await change(id, { location: 'Sample Office' });

    assert.equal(await stageOf(candidate.id), 'offer_sent');
    assert.equal((await historyOf(candidate.id)).length, rowsBefore);
  });

  test('a refused save changes nothing: no offer, no stage change, no history', async () => {
    const { candidate, id } = await offered({ offerStatus: 'sent' });
    // Something outside the offer has moved the candidate elsewhere.
    await db.pool.query(
      `UPDATE pipeline_status SET current_stage = 'on_hold', hold_reason = 'Sample'
        WHERE candidate_id = $1`,
      [candidate.id],
    );
    const rowsBefore = (await historyOf(candidate.id)).length;

    const res = await change(id, { offerStatus: 'accepted', location: 'Sample Office' });

    assert.equal(res.status, 422);
    assert.match(res.body.fields.offerStatus, /is at "On Hold"/);
    assert.equal(await stageOf(candidate.id), 'on_hold');
    assert.equal((await historyOf(candidate.id)).length, rowsBefore);
    const now = (await view(id)).body.offer;
    assert.equal(now.offerStatus, 'sent');
    assert.equal(now.location, null);
  });
});

describe('the direct interview after an offer exists', () => {
  test('its result can no longer be changed, even while the stage is still Selected', async () => {
    const { candidate } = await offered();

    const res = await api(`/interviews/${candidate.interviewId}`, {
      method: 'PATCH',
      cookie: admin.cookie,
      body: { decision: 'not_selected', rejectReason: 'Changed afterwards' },
    });

    assert.equal(res.status, 422);
    assert.match(res.body.fields.decision, /offer has been created/);
    assert.equal(await stageOf(candidate.id), 'selected');
  });

  test('its remarks can still be edited', async () => {
    const { candidate } = await offered({ offerStatus: 'sent' });

    const res = await api(`/interviews/${candidate.interviewId}`, {
      method: 'PATCH',
      cookie: admin.cookie,
      body: { remarks: 'Added afterwards' },
    });

    assert.equal(res.status, 200);
    assert.equal(await stageOf(candidate.id), 'offer_sent');
  });
});

describe('changing and viewing an offer', () => {
  test('changes only the fields that were sent', async () => {
    const { id } = await offered({ offerDate: '2026-11-05', location: 'Sample Office' });
    const res = await change(id, { positionId: otherPosition.id });

    assert.equal(res.status, 200);
    assert.equal(res.body.offer.position, 'Sample Position B');
    assert.equal(res.body.offer.offerDate, '2026-11-05');
    assert.equal(res.body.offer.location, 'Sample Office');
  });

  test('the Work Mode can be set, changed back to empty, and is kept across edits', async () => {
    const { id } = await offered();

    const set = await change(id, { workMode: 'office' });
    assert.equal(set.status, 200);
    assert.equal(set.body.offer.workMode, 'office');

    // An unrelated edit leaves it alone.
    await change(id, { location: 'Sample Office' });
    assert.equal((await view(id)).body.offer.workMode, 'office');

    const cleared = await change(id, { workMode: null });
    assert.equal(cleared.status, 200);
    assert.equal(cleared.body.offer.workMode, null);
  });

  test('validates the change, and saves nothing when it fails', async () => {
    const { id } = await offered({ location: 'Sample Office' });
    const res = await change(id, { location: 'Changed', offerDate: 'tomorrow' });

    assert.equal(res.status, 422);
    assert.ok(res.body.fields.offerDate);
    assert.equal((await view(id)).body.offer.location, 'Sample Office');
  });

  test('a new position must be in use, but the one already on the offer stays valid', async () => {
    const { id } = await offered();
    const retired = await change(id, { positionId: retiredPosition.id });

    assert.equal(retired.status, 422);
    assert.match(retired.body.fields.positionId, /no longer in use/);

    await db.pool.query('UPDATE offers SET position_id = $1 WHERE id = $2', [
      retiredPosition.id,
      id,
    ]);
    assert.equal((await change(id, { location: 'Sample Office' })).status, 200);
  });

  test('clearing the onboarding date is refused while attendance is recorded', async () => {
    const { id } = await offered({
      offerStatus: 'accepted',
      onboardingDate: '2026-11-16',
      attended: true,
    });
    const res = await change(id, { onboardingDate: null });

    assert.equal(res.status, 422);
    assert.ok(res.body.fields.onboardingDate);
  });

  test('returns the full record with the candidate and the current stage', async () => {
    const { id, candidate } = await offered({
      offerStatus: 'accepted',
      onboardingDate: '2026-11-16',
    });
    const res = await view(id);

    assert.equal(res.status, 200);
    assert.equal(res.body.candidate.candidateCode, candidate.candidateCode);
    assert.equal(res.body.candidate.stage.name, 'Offer Accepted');
    assert.equal(res.body.offer.offerStatus, 'accepted');
    assert.equal(res.body.offer.onboardingDate, '2026-11-16');
  });

  test('answers "not found" for an unknown or malformed id', async () => {
    assert.equal((await view(999999)).status, 404);
    assert.equal((await view('abc')).status, 404);
    assert.equal((await change(999999, { location: 'x' })).status, 404);
  });
});

describe('listing', () => {
  let listed;

  before(async () => {
    listed = {
      waiting: await selectedCandidate({ fullName: 'Numbat Waiting', candidateCode: 'OFL-WAIT' }),
      unsent: await selectedCandidate({ fullName: 'Numbat Unsent' }),
      sent: await selectedCandidate({ fullName: 'Numbat Sent' }),
      accepted: await selectedCandidate({ fullName: 'Numbat Accepted' }),
      joined: await selectedCandidate({ fullName: 'Numbat Joined' }),
      notSelected: await interviewedCandidate(ATTENDED_INTERVIEW, { fullName: 'Numbat Undecided' }),
    };
    const make = (candidate, body) =>
      create({ candidateId: candidate.id, positionId: position.id, ...body });
    await make(listed.unsent, {});
    await make(listed.sent, { offerStatus: 'sent', offerDate: '2026-11-05' });
    await make(listed.accepted, {
      offerStatus: 'accepted',
      onboardingDate: '2026-11-16',
      location: 'Sample Office',
    });
    await make(listed.joined, {
      offerStatus: 'accepted',
      onboardingDate: '2026-12-01',
      attended: true,
    });
  });

  const list = (query = '') => api(`/offers${query}`, { cookie: admin.cookie });
  const names = (res) => res.body.items.map((item) => item.candidate.fullName).sort();

  test('shows candidates with an offer and those waiting for one, but nobody else', async () => {
    assert.deepEqual(names(await list('?search=Numbat')), [
      'Numbat Accepted',
      'Numbat Joined',
      'Numbat Sent',
      'Numbat Unsent',
      'Numbat Waiting',
    ]);
  });

  test('a waiting candidate has no offer yet', async () => {
    const item = (await list('?search=Numbat%20Waiting')).body.items[0];

    assert.equal(item.offer, null);
    assert.equal(item.candidate.stage.name, 'Selected');
  });

  test('returns only the fields the list screen needs', async () => {
    const item = (await list('?search=Numbat%20Accepted')).body.items[0];

    assert.deepEqual(Object.keys(item).sort(), ['candidate', 'offer']);
    assert.deepEqual(Object.keys(item.candidate).sort(), [
      'candidateCode',
      'fullName',
      'id',
      'position',
      'stage',
    ]);
    assert.deepEqual(Object.keys(item.offer).sort(), [
      'attended',
      'id',
      'location',
      'offerDate',
      'offerStatus',
      'onboardingDate',
      'position',
      'workMode',
    ]);
    assert.equal(item.offer.position, 'Sample Position A');
    assert.equal(item.offer.location, 'Sample Office');
  });

  test('searches by name and Candidate ID', async () => {
    assert.deepEqual(names(await list('?search=numbat%20sent')), ['Numbat Sent']);
    assert.deepEqual(names(await list('?search=ofl-wait')), ['Numbat Waiting']);
  });

  test('filters by offer status, including "no status yet"', async () => {
    assert.deepEqual(names(await list('?search=Numbat&offerStatus=sent')), ['Numbat Sent']);
    assert.deepEqual(names(await list('?search=Numbat&offerStatus=accepted')), [
      'Numbat Accepted',
      'Numbat Joined',
    ]);
    assert.deepEqual(names(await list('?search=Numbat&offerStatus=pending')), [
      'Numbat Unsent',
      'Numbat Waiting',
    ]);
  });

  test('filters by onboarding date', async () => {
    assert.deepEqual(names(await list('?search=Numbat&onboardingFrom=2026-11-20')), [
      'Numbat Joined',
    ]);
    assert.deepEqual(names(await list('?search=Numbat&onboardingTo=2026-11-20')), [
      'Numbat Accepted',
    ]);
    assert.deepEqual(
      names(await list('?search=Numbat&onboardingFrom=2026-11-01&onboardingTo=2026-12-31')),
      ['Numbat Accepted', 'Numbat Joined'],
    );
  });

  test('can list only the selected candidates who still need an offer', async () => {
    assert.deepEqual(names(await list('?search=Numbat&waiting=true')), ['Numbat Waiting']);
  });

  test('pages through the results and caps the page size', async () => {
    const first = await list('?search=Numbat&pageSize=3&page=1');
    const second = await list('?search=Numbat&pageSize=3&page=2');

    assert.equal(first.body.total, 5);
    assert.equal(first.body.items.length, 3);
    assert.equal(second.body.items.length, 2);
    assert.equal((await list('?pageSize=9999')).body.pageSize, 100);
  });

  test('ignores an unknown filter value', async () => {
    assert.equal(
      (await list(`?search=Numbat&offerStatus=${encodeURIComponent("x' OR 1=1")}`)).body.total,
      5,
    );
    assert.equal((await list('?search=Numbat&onboardingFrom=soon')).body.total, 5);
  });
});

describe('audit log', () => {
  test('creating with a status writes the create and the stage change', async () => {
    const { candidate, id } = await offered({ offerStatus: 'sent' });

    assert.deepEqual(await auditActions(candidate.id, id), [
      'OFFER_CREATE',
      'PIPELINE_STAGE_CHANGE',
    ]);
  });

  test('creating without a status writes only the create', async () => {
    const { candidate, id } = await offered();

    assert.deepEqual(await auditActions(candidate.id, id), ['OFFER_CREATE']);
  });

  test('the stage change row says who, from what and to what', async () => {
    const { candidate } = await offered({ offerStatus: 'sent' });
    const { rows } = await db.pool.query(
      `SELECT actor_user_id, old_values, new_values, details FROM audit_log
        WHERE action = 'PIPELINE_STAGE_CHANGE' AND entity_id = $1 AND details->>'source' = 'offer'`,
      [candidate.id],
    );

    assert.equal(rows[0].actor_user_id, String(admin.id));
    assert.deepEqual(rows[0].old_values, { stage: 'selected' });
    assert.deepEqual(rows[0].new_values, { stage: 'offer_sent' });
    assert.deepEqual(rows[0].details, { source: 'offer' });
  });

  test('an edit records only the fields that changed', async () => {
    const { id } = await offered({ offerStatus: 'sent' });
    await change(id, { offerStatus: 'accepted' });
    const { rows } = await db.pool.query(
      `SELECT old_values, new_values FROM audit_log WHERE action = 'OFFER_UPDATE' AND entity_id = $1`,
      [id],
    );

    assert.deepEqual(rows[0].old_values, { offerStatus: 'sent' });
    assert.deepEqual(rows[0].new_values, { offerStatus: 'accepted' });
  });

  test('an edit that changes nothing, and a refused save, record nothing', async () => {
    const { candidate, id } = await offered({ offerStatus: 'sent' });
    const before = await auditActions(candidate.id, id);

    await change(id, { offerStatus: 'sent' });
    await change(id, { offerStatus: 'declined' });

    assert.deepEqual(await auditActions(candidate.id, id), before);
  });
});

describe('salary is not part of this module', () => {
  test('the offers table has no salary column, and there is no salary table', async () => {
    const columns = await db.pool.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = $1 AND table_name = 'offers'`,
      [db.schema],
    );
    const tables = await db.pool.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = $1`,
      [db.schema],
    );

    assert.ok(columns.rows.length > 0);
    assert.deepEqual(
      columns.rows.filter((row) => /salary/i.test(row.column_name)),
      [],
    );
    assert.deepEqual(
      tables.rows.filter((row) => /salary/i.test(row.table_name)),
      [],
    );
  });

  test('no answer from the offer routes mentions salary', async () => {
    const { id, candidate } = await offered({ offerStatus: 'sent' });
    const answers = [
      await view(id),
      await api('/offers', { cookie: admin.cookie }),
      await change(id, { location: 'Sample Office' }),
      await create({ candidateId: candidate.id, positionId: position.id }),
    ];

    for (const answer of answers) assert.doesNotMatch(JSON.stringify(answer.body), /salary/i);
  });

  test('a salary sent by the browser is ignored and never stored or audited', async () => {
    const candidate = await selectedCandidate();
    const res = await create({
      candidateId: candidate.id,
      positionId: position.id,
      salaryLkr: 123456,
      salary_lkr: 123456,
    });

    assert.equal(res.status, 201);
    assert.doesNotMatch(JSON.stringify(res.body), /salary|123456/i);
    const { rows } = await db.pool.query(
      `SELECT new_values::text AS stored FROM audit_log WHERE entity_type = 'offers' AND entity_id = $1`,
      [res.body.offer.id],
    );
    assert.doesNotMatch(rows[0].stored, /salary|123456/i);
  });

  test('the offers table exists, and no notification, email or account table', async () => {
    const { rows } = await db.pool.query(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = $1
          AND table_name IN ('offers', 'notifications', 'email_templates', 'email_log',
                             'team_leads', 'company_accounts')`,
      [db.schema],
    );

    assert.deepEqual(
      rows.map((row) => row.table_name),
      ['offers'],
    );
  });
});
