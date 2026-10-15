import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { auditActions, inDays, isoDay, startHarness } from './helpers/harness.js';

// Prepare Offer: the offer the direct interview creates automatically is the
// one HR completes. Every candidate, position and amount is made up.

let h;
let hr;
let teamLead;
let intern;
let position;
let otherPosition;

const offerRows = (candidateId) =>
  h.query('SELECT * FROM offers WHERE candidate_id = $1 ORDER BY id', [candidateId]);

// A candidate whose direct interview result is Selected, so the offer exists.
async function selectedWithOffer(fullName) {
  const candidate = await h.newCandidate({ positionId: position.id, fullName });
  await h.phoneSelected(candidate, inDays(3));
  const interview = await h.directInterview(candidate, inDays(2), {
    attendance: 'attended',
    scoreTechnical: 8,
    scoreAi: 7,
    scoreCommunication: 9,
    scoreConfidence: 6,
    scoreCultureFit: 10,
    decision: 'selected',
  });
  assert.equal(interview.status, 201, JSON.stringify(interview.body));
  const [offer] = await offerRows(candidate.id);
  assert.ok(offer, 'the offer was created automatically');
  return { candidate, offerId: Number(offer.id) };
}

before(async () => {
  h = await startHarness();
  hr = await h.signedIn({ roleCode: 'hr' });
  teamLead = await h.signedIn({ roleCode: 'team_lead' });
  intern = await h.signedIn({ roleCode: 'intern_dev' });
  position = await h.lookup('positions', 'Prepare Position A');
  otherPosition = await h.lookup('positions', 'Prepare Position B');
});

after(async () => {
  await h.stop();
});

describe('selecting a candidate and loading the offer', () => {
  test('a Selected candidate is listed with the offer the interview created', async () => {
    const { candidate, offerId } = await selectedWithOffer('Prepare Listed');

    const res = await h.api(`/offers?search=${candidate.candidateCode}`, h.asAdmin);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const entry = res.body.items.find((e) => e.candidate.id === candidate.id);
    assert.equal(entry.offer.id, offerId);
    assert.equal(entry.candidate.stage.code, 'selected');

    const byName = await h.api('/offers?search=Prepare%20Listed', h.asAdmin);
    assert.ok(byName.body.items.some((e) => e.candidate.id === candidate.id));
  });

  test('the offer loads with its current values and no salary', async () => {
    const { offerId } = await selectedWithOffer('Prepare Loaded');
    const res = await h.api(`/offers/${offerId}`, h.asAdmin);
    assert.equal(res.status, 200);
    assert.equal(res.body.offer.id, offerId);
    assert.equal(res.body.offer.positionId, position.id);
    assert.equal(res.body.offer.offerStatus, null);
    assert.doesNotMatch(JSON.stringify(res.body), /salary/i);
  });
});

describe('saving the offer', () => {
  test('updates the same offer record, keeps one row and audits it', async () => {
    const { candidate, offerId } = await selectedWithOffer('Prepare Saved');

    const res = await h.api(`/offers/${offerId}`, {
      method: 'PATCH',
      ...h.asAdmin,
      body: {
        positionId: otherPosition.id,
        offerDate: isoDay(inDays(1)),
        workMode: 'office',
        location: 'Sample Office',
        offerStatus: 'sent',
      },
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.offer.id, offerId);
    assert.equal(res.body.candidate.stage.code, 'offer_sent');
    assert.doesNotMatch(JSON.stringify(res.body), /salary/i);

    const rows = await offerRows(candidate.id);
    assert.equal(rows.length, 1);
    assert.equal(Number(rows[0].id), offerId);
    assert.equal(rows[0].offer_status, 'sent');
    assert.equal(rows[0].location, 'Sample Office');
    assert.ok((await auditActions(h, 'offers', offerId)).includes('OFFER_UPDATE'));
  });

  test('a second offer for the same candidate is refused and the first is untouched', async () => {
    const { candidate, offerId } = await selectedWithOffer('Prepare Duplicate');
    const before = await offerRows(candidate.id);

    const res = await h.api('/offers', {
      method: 'POST',
      ...h.asAdmin,
      body: { candidateId: candidate.id, positionId: position.id },
    });
    assert.equal(res.status, 409);
    assert.equal(res.body.offerId, offerId);
    assert.deepEqual(await offerRows(candidate.id), before);
  });

  test('missing or invalid fields are refused and nothing changes', async () => {
    const { candidate, offerId } = await selectedWithOffer('Prepare Invalid');
    const before = await offerRows(candidate.id);

    const noPosition = await h.api(`/offers/${offerId}`, {
      method: 'PATCH',
      ...h.asAdmin,
      body: { positionId: null },
    });
    assert.equal(noPosition.status, 422);
    assert.ok(noPosition.body.fields.positionId);

    const badStatus = await h.api(`/offers/${offerId}`, {
      method: 'PATCH',
      ...h.asAdmin,
      body: { offerStatus: 'withdrawn' },
    });
    assert.equal(badStatus.status, 422);
    assert.ok(badStatus.body.fields.offerStatus);

    // Attendance needs an accepted offer with a joining date: no shortcut.
    const early = await h.api(`/offers/${offerId}`, {
      method: 'PATCH',
      ...h.asAdmin,
      body: { attended: true },
    });
    assert.equal(early.status, 422);
    assert.deepEqual(await offerRows(candidate.id), before);
  });

  test('walks Selected, Offer Sent, Offer Accepted and Joined, then locks the joining fields', async () => {
    const { candidate, offerId } = await selectedWithOffer('Prepare Journey');
    const patch = (body) => h.api(`/offers/${offerId}`, { method: 'PATCH', ...h.asAdmin, body });

    const sent = await patch({ offerStatus: 'sent' });
    assert.equal(sent.body.candidate.stage.code, 'offer_sent');
    const accepted = await patch({
      offerStatus: 'accepted',
      onboardingDate: isoDay(inDays(5)),
    });
    assert.equal(accepted.body.candidate.stage.code, 'offer_accepted');
    const joined = await patch({ attended: true });
    assert.equal(joined.status, 200, JSON.stringify(joined.body));
    assert.equal(joined.body.candidate.stage.code, 'joined');

    const employees = await h.query(
      'SELECT count(*)::int AS n FROM employees WHERE candidate_id = $1',
      [candidate.id],
    );
    assert.equal(employees[0].n, 1);

    const lateChange = await patch({ onboardingDate: isoDay(inDays(9)) });
    assert.ok(lateChange.status >= 400, 'the settled joining cannot be changed');
    assert.match(JSON.stringify(lateChange.body), /can no longer be changed/);

    // The rest of the offer can still be updated.
    const location = await patch({ location: 'Updated Office' });
    assert.equal(location.status, 200, JSON.stringify(location.body));
    assert.equal((await offerRows(candidate.id)).length, 1);
  });
});

describe('who may use it', () => {
  test('HR, Team Lead and signed-out callers cannot change an offer', async () => {
    const { candidate, offerId } = await selectedWithOffer('Prepare Guarded');
    const before = await offerRows(candidate.id);

    // Intern / Dev holds offers.manage in the approved role design (test data only).
    for (const who of [hr, teamLead]) {
      const res = await h.api(`/offers/${offerId}`, {
        method: 'PATCH',
        cookie: who.cookie,
        body: { location: 'Not allowed' },
      });
      assert.equal(res.status, 403, who.email);
    }
    const anonymous = await h.api(`/offers/${offerId}`, {
      method: 'PATCH',
      body: { location: 'Not allowed' },
    });
    assert.equal(anonymous.status, 401);
    assert.deepEqual(await offerRows(candidate.id), before);
  });

  test('no role other than the Main User sees salary through the offer APIs', async () => {
    const { candidate, offerId } = await selectedWithOffer('Prepare Confidential');
    const put = await h.api(`/salary/${candidate.id}`, {
      method: 'PUT',
      ...h.asAdmin,
      body: { salaryLkr: 765432.1 },
    });
    assert.equal(put.status, 200);

    for (const who of [
      { cookie: hr.cookie },
      { cookie: teamLead.cookie },
      { cookie: intern.cookie },
    ]) {
      for (const path of [
        `/offers/${offerId}`,
        '/offers?pageSize=100',
        `/salary/${candidate.id}`,
      ]) {
        const res = await h.api(path, who);
        const text = JSON.stringify(res.body);
        assert.ok(!text.includes('765432'), `${path} must not carry the amount`);
      }
      assert.equal((await h.api(`/salary/${candidate.id}`, who)).status, 403);
    }
    // And not even the Main User gets it from the offer endpoints.
    for (const path of [`/offers/${offerId}`, '/offers?pageSize=100']) {
      assert.ok(!JSON.stringify((await h.api(path, h.asAdmin)).body).includes('765432'));
    }
  });
});

describe('automatic creation is preserved', () => {
  test('marking the direct interview Selected still creates exactly one offer', async () => {
    const { candidate } = await selectedWithOffer('Prepare Automatic');
    assert.equal((await offerRows(candidate.id)).length, 1);

    // Editing the interview again never adds another.
    const interviews = await h.query('SELECT id FROM interviews WHERE candidate_id = $1', [
      candidate.id,
    ]);
    const edit = await h.api(`/interviews/${interviews[0].id}`, {
      method: 'PATCH',
      ...h.asAdmin,
      body: { remarks: 'Edited remark' },
    });
    assert.ok(edit.status < 500);
    assert.equal((await offerRows(candidate.id)).length, 1);
  });
});
