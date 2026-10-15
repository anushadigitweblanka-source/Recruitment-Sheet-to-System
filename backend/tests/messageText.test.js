import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { previewMessage } from '../src/modules/notifications/messageText.js';
import { inDays, isoDay, startHarness } from './helpers/harness.js';

// The WhatsApp / SMS text: preview and copy only. Every name, number and
// address is made up. Nothing is sent, so there is nothing to spy on; the
// tests check that nothing is logged either.

let h;
let position;

const preview = (candidateId, type) =>
  h.api(`/candidates/${candidateId}/messages/preview`, {
    method: 'POST',
    ...h.asAdmin,
    body: { type },
  });
const count = async (table, candidateId) =>
  Number(
    (await h.query(`SELECT count(*) AS n FROM ${table} WHERE candidate_id = $1`, [candidateId]))[0]
      .n,
  );

before(async () => {
  h = await startHarness();
  position = await h.lookup('positions', 'Sample Position');
  await h.setSetting('interview_venue', 'Sample Office, Floor 2');
  await h.setSetting('company_cv_template_url', 'https://example.test/company-cv-template');
});

after(async () => {
  await h.stop();
});

describe('interview invitation text', () => {
  test('is built from the candidate and the interview slot, for the candidate’s phone', async () => {
    const candidate = await h.newCandidate({ positionId: position.id, fullName: 'Text Sample' });
    await h.phoneSelected(candidate, inDays(4));

    const res = await preview(candidate.id, 'interview_invitation');
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.to, candidate.phone);
    assert.equal(res.body.canCopy, true);
    assert.deepEqual(res.body.missing, []);
    assert.match(res.body.text, /^Hello Text Sample, you are invited to a direct interview/);
    assert.match(res.body.text, /for the Sample Position position/);
    assert.match(res.body.text, /on \d{2} \w{3} \d{4} at \d{2}:\d{2} at Sample Office, Floor 2\./);
    assert.match(res.body.text, /Please reply to confirm/);
  });

  test('says what is missing and gives no text when the interview time is not set', async () => {
    const candidate = await h.newCandidate({ positionId: position.id });
    const res = await preview(candidate.id, 'interview_invitation');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.missing, ['interview date and time']);
    assert.equal(res.body.canCopy, false);
    assert.equal(res.body.text, '');
  });
});

describe('joining information text', () => {
  test('uses the joining date and location and leaves everything else out', async () => {
    const candidate = await h.newCandidate({ positionId: position.id, fullName: 'Join Sample' });
    const onboardingDate = isoDay(inDays(12));
    await h.offered(candidate, { positionId: position.id, onboardingDate });

    const res = await preview(candidate.id, 'joining_onboarding');
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.canCopy, true);
    assert.match(res.body.text, /^Hello Join Sample, we are pleased to confirm your joining/);
    assert.match(res.body.text, /as Sample Position/);
    assert.match(res.body.text, /at Sample Office, Floor 2/);
  });

  test('is blocked without a joining date', async () => {
    const candidate = await h.newCandidate({ positionId: position.id });
    const res = await preview(candidate.id, 'joining_onboarding');
    assert.deepEqual(res.body.missing, ['joining date']);
    assert.equal(res.body.canCopy, false);
    assert.equal(res.body.text, '');
  });
});

describe('safety', () => {
  test('never carries salary, credentials, links or secrets, and sends or logs nothing', async () => {
    const candidate = await h.newCandidate({ positionId: position.id });
    await h.offered(candidate, { positionId: position.id });
    await h.api(`/salary/${candidate.id}`, {
      method: 'PUT',
      ...h.asAdmin,
      body: { salaryLkr: 987654 },
    });

    for (const type of ['interview_invitation', 'joining_onboarding']) {
      const res = await preview(candidate.id, type);
      assert.equal(res.status, 200, JSON.stringify(res.body));
      const everything = JSON.stringify(res.body);
      assert.ok(!everything.includes('987654'), 'no salary amount');
      assert.ok(!everything.includes(candidate.email), 'no email address');
      assert.doesNotMatch(everything, /salary|password|credential|secret|token|https?:\/\//i);
    }

    assert.equal(await count('email_log', candidate.id), 0);
    assert.equal(await count('company_cv_links', candidate.id), 0);
  });

  test('refuses an unknown type, an unknown candidate and a signed-out caller', async () => {
    const candidate = await h.newCandidate({ positionId: position.id });
    const type = await preview(candidate.id, 'status_rejected_on_hold');
    assert.equal(type.status, 422);
    assert.ok(type.body.fields.type);

    const unknown = await preview(999999999, 'interview_invitation');
    assert.equal(unknown.status, 404);

    const signedOut = await h.api(`/candidates/${candidate.id}/messages/preview`, {
      method: 'POST',
      body: { type: 'interview_invitation' },
    });
    assert.equal(signedOut.status, 401);
  });
});

describe('required information', () => {
  // A stand-in database that returns one candidate without a phone number.
  const noPhone = {
    async query(sql) {
      if (/FROM candidates c/.test(sql)) {
        return {
          rows: [
            {
              id: 1,
              candidate_code: 'MSG-0001',
              full_name: 'No Phone Sample',
              email: 'no.phone@example.test',
              phone: null,
              position_name: 'Sample Position',
              current_stage: 'interview_scheduled',
              interview_at: new Date('2026-11-04T09:00:00Z'),
              planned_at: null,
              onboarding_date: null,
              offer_location: null,
            },
          ],
        };
      }
      return { rows: [] };
    },
  };

  test('a missing phone number is named and blocks copying', async () => {
    const result = await previewMessage(noPhone, { candidateId: 1, type: 'interview_invitation' });
    assert.equal(result.ok, true);
    assert.deepEqual(result.data.missing, ['candidate phone number']);
    assert.equal(result.data.canCopy, false);
    assert.equal(result.data.text, '');
    assert.equal(result.data.to, null);
  });
});
