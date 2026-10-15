import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { inDays, isoDay, startHarness } from './helpers/harness.js';

// The Offer List salary column: salary arrives only through the Main-User-only
// batch route, every read is audited without the amount, and the general
// offers list stays free of salary. Every name and amount is made up.

const PAY_ONE = 456789.12;

let h;
let hr;
let teamLead;
let intern;
let one;
let two;

before(async () => {
  h = await startHarness();
  hr = await h.signedIn({ roleCode: 'hr' });
  teamLead = await h.signedIn({ roleCode: 'team_lead' });
  intern = await h.signedIn({ roleCode: 'intern_dev' });
  const position = await h.lookup('positions', 'Sample Position');
  one = await h.newCandidate({ positionId: position.id, fullName: 'List Pay One' });
  two = await h.newCandidate({ positionId: position.id, fullName: 'List Pay Two' });
  for (const candidate of [one, two]) {
    await h.offered(candidate, { positionId: position.id, onboardingDate: isoDay(inDays(10)) });
  }
  const put = await h.api(`/salary/${one.id}`, {
    method: 'PUT',
    ...h.asAdmin,
    body: { salaryLkr: PAY_ONE },
  });
  assert.equal(put.status, 200, JSON.stringify(put.body));
});

after(async () => {
  await h.stop();
});

const list = (ids, who = h.asAdmin) => h.api(`/salary?candidateIds=${ids.join(',')}`, who);

describe('the batch salary route', () => {
  test('gives the Main User the salaries, with null where none is entered', async () => {
    const res = await list([one.id, two.id]);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const byId = Object.fromEntries(res.body.items.map((i) => [i.candidateId, i.salaryLkr]));
    assert.equal(byId[one.id], PAY_ONE);
    assert.equal(byId[two.id], null);
  });

  test('refuses HR, Team Lead, Intern / Dev and signed-out callers without any amount', async () => {
    for (const who of [hr, teamLead, intern]) {
      const res = await list([one.id], { cookie: who.cookie });
      assert.equal(res.status, 403);
      assert.ok(!JSON.stringify(res.body).includes('456789'));
    }
    assert.equal((await list([one.id], {})).status, 401);
  });

  test('validates the ids and ignores ones that are not candidates', async () => {
    assert.equal((await h.api('/salary', h.asAdmin)).status, 422);
    assert.equal((await h.api('/salary?candidateIds=abc,0,-4', h.asAdmin)).status, 422);
    const many = Array.from({ length: 101 }, (_, i) => i + 1);
    assert.equal((await list(many)).status, 422);

    const res = await list([one.id, 999999999]);
    assert.equal(res.status, 200);
    assert.deepEqual(
      res.body.items.map((i) => i.candidateId),
      [one.id],
    );
  });

  test('does not add a second salary record, and a change reaches the next read', async () => {
    for (const amount of [PAY_ONE, 500000]) {
      const put = await h.api(`/salary/${one.id}`, {
        method: 'PUT',
        ...h.asAdmin,
        body: { salaryLkr: amount },
      });
      assert.equal(put.status, 200);
    }
    const rows = await h.query(
      'SELECT count(*)::int AS n FROM offer_salary WHERE candidate_id = $1',
      [one.id],
    );
    assert.equal(rows[0].n, 1);
    const res = await list([one.id]);
    assert.equal(res.body.items[0].salaryLkr, 500000);
  });
});

describe('the general offers list', () => {
  test('carries no salary for anyone, including the Main User', async () => {
    for (const who of [h.asAdmin, { cookie: hr.cookie }, { cookie: teamLead.cookie }]) {
      const res = await h.api('/offers', who);
      // A Team Lead without candidates.view is refused the list altogether.
      assert.ok([200, 403].includes(res.status), JSON.stringify(res.body));
      const text = JSON.stringify(res.body);
      assert.doesNotMatch(text, /salary/i);
      assert.ok(!text.includes('456789') && !text.includes('500000'));
    }
  });
});

describe('audit', () => {
  test('each salary read is audited per candidate, and a change is audited, without amounts', async () => {
    const [{ top }] = await h.query('SELECT COALESCE(max(id), 0) AS top FROM audit_log');

    await list([one.id, two.id]);
    await h.api(`/salary/${two.id}`, {
      method: 'PUT',
      ...h.asAdmin,
      body: { salaryLkr: 321000 },
    });
    // A refused read must not be recorded as a salary view.
    await list([one.id], { cookie: hr.cookie });

    const rows = await h.query(
      `SELECT action, actor_user_id, entity_type, entity_id, details
         FROM audit_log WHERE id > $1 AND entity_type = 'offer_salary' ORDER BY id`,
      [top],
    );
    assert.deepEqual(
      rows.map((r) => [r.action, Number(r.entity_id)]),
      [
        ['SALARY_VIEW', one.id],
        ['SALARY_VIEW', two.id],
        ['SALARY_CHANGE', two.id],
      ],
    );
    for (const row of rows) assert.equal(Number(row.actor_user_id), h.admin.id);
    assert.equal(rows[0].details.found, true);
    assert.equal(rows[1].details.found, false);
    assert.equal(rows[0].details.source, 'offer_list');

    const everything = JSON.stringify(rows);
    assert.ok(!everything.includes('456789') && !everything.includes('321000'));
    assert.ok(!everything.includes('500000'));
  });
});
