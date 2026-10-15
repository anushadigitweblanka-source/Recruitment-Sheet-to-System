import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { inDays, isoDay, startHarness } from './helpers/harness.js';

// What the Create Offer page relies on: search by Candidate ID or name, the
// offer of a candidate found by their ID, and the server refusing an offer
// for anyone who is not Selected or who already has one. Every name is made up.

let h;
let position;
let ineligible;
let withOffer;

const offerCount = async (candidateId) =>
  (await h.query('SELECT count(*)::int AS n FROM offers WHERE candidate_id = $1', [candidateId]))[0]
    .n;
const createOffer = (candidateId) =>
  h.api('/offers', {
    method: 'POST',
    ...h.asAdmin,
    body: { candidateId, positionId: position.id },
  });

before(async () => {
  h = await startHarness();
  position = await h.lookup('positions', 'Sample Position');
  ineligible = await h.newCandidate({ positionId: position.id, fullName: 'Flow Ineligible' });
  withOffer = await h.newCandidate({ positionId: position.id, fullName: 'Flow Offered' });
  await h.offered(withOffer, { positionId: position.id, onboardingDate: isoDay(inDays(10)) });
});

after(async () => {
  await h.stop();
});

describe('finding a candidate', () => {
  test('the candidate search finds anyone by Candidate ID or by name, with their status', async () => {
    const byCode = await h.api(`/candidates?search=${ineligible.candidateCode}`, h.asAdmin);
    assert.equal(byCode.status, 200);
    const found = byCode.body.items.find((c) => c.id === ineligible.id);
    assert.equal(found.stage.code, 'applied');

    const byName = await h.api('/candidates?search=Flow%20Offered', h.asAdmin);
    assert.ok(byName.body.items.some((c) => c.id === withOffer.id));
  });

  test('the offer list, searched by Candidate ID, returns the offer of whoever has one', async () => {
    const res = await h.api(`/offers?search=${withOffer.candidateCode}`, h.asAdmin);
    const entry = res.body.items.find((e) => e.candidate.id === withOffer.id);
    assert.ok(entry.offer, 'the existing offer is returned');
    assert.equal(entry.offer.position, 'Sample Position');
  });

  test('a candidate who is neither Selected nor holds an offer is not in the offer list', async () => {
    const res = await h.api(`/offers?search=${ineligible.candidateCode}`, h.asAdmin);
    assert.ok(!res.body.items.some((e) => e.candidate.id === ineligible.id));
  });

  test('"waiting for an offer" never includes someone who already has one', async () => {
    const res = await h.api('/offers?waiting=true&pageSize=100', h.asAdmin);
    assert.ok(!res.body.items.some((e) => e.candidate.id === withOffer.id));
  });
});

describe('the server keeps the workflow', () => {
  test('refuses an offer for a candidate who is not Selected, and stores nothing', async () => {
    const res = await createOffer(ineligible.id);
    assert.equal(res.status, 422);
    assert.match(res.body.fields.candidateId, /This candidate is at "Applied"/);
    assert.equal(await offerCount(ineligible.id), 0);
  });

  test('refuses a second offer, points to the first and changes nothing', async () => {
    const before = await h.query('SELECT * FROM offers WHERE candidate_id = $1', [withOffer.id]);
    const res = await createOffer(withOffer.id);
    assert.equal(res.status, 409);
    assert.equal(res.body.offerId, Number(before[0].id));
    assert.equal(await offerCount(withOffer.id), 1);

    const after = await h.query('SELECT * FROM offers WHERE candidate_id = $1', [withOffer.id]);
    assert.deepEqual(after, before, 'the existing offer is untouched');
  });

  test('no salary comes back with an offer, found or created', async () => {
    const res = await h.api(`/offers?search=${withOffer.candidateCode}`, h.asAdmin);
    assert.doesNotMatch(JSON.stringify(res.body), /salary/i);
  });
});
