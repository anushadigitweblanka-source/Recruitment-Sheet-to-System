import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { auditActions, inDays, isoDay, startHarness } from './helpers/harness.js';

// Stage 11: the company account lifecycle and the temporary-password rules.
// IMPLEMENTED_FROM_TASK_GUIDE. Every address and password below is made up
// and generated for the test run; nothing real is used.

const KEY = randomBytes(32).toString('base64');

let h;
let hr;
let teamLead;
let intern;
let position;

// A candidate who has attended: an employee in evaluation with an account
// request.
async function attended(fullName) {
  const candidate = await h.newCandidate({ positionId: position.id, fullName });
  const { employeeId } = await h.joined(candidate, {
    positionId: position.id,
    onboardingDate: isoDay(inDays(-3)),
  });
  const [account] = await h.query('SELECT id FROM company_accounts WHERE candidate_id = $1', [
    candidate.id,
  ]);
  return { candidate, employeeId, accountId: Number(account.id) };
}

const statusOf = async (accountId) =>
  (await h.query('SELECT status FROM company_accounts WHERE id = $1', [accountId]))[0].status;
const secretCount = async (accountId) =>
  (await h.query('SELECT 1 FROM company_account_secrets WHERE account_id = $1', [accountId]))
    .length;

before(async () => {
  h = await startHarness({ config: { companySecretKey: KEY } });
  hr = await h.signedIn({ roleCode: 'hr' });
  teamLead = await h.signedIn({ roleCode: 'team_lead' });
  intern = await h.signedIn({ roleCode: 'intern_dev' });
  position = await h.lookup('positions', 'Sample Position');
});

after(async () => {
  await h.stop();
});

describe('the lifecycle', () => {
  test('Attended = Yes requests an account, once, and the employee profile shows it', async () => {
    const { candidate, employeeId, accountId } = await attended('Account Sample 1');

    assert.equal(await statusOf(accountId), 'requested');
    const profile = await h.api(`/employees/${employeeId}`, h.asAdmin);
    assert.equal(profile.body.companyAccount.status, 'requested');
    assert.equal(profile.body.companyAccount.companyEmail, null);

    // Editing the offer again does not request a second account.
    const offer = (
      await h.query('SELECT id FROM offers WHERE candidate_id = $1', [candidate.id])
    )[0];
    await h.api(`/offers/${offer.id}`, {
      method: 'PATCH',
      ...h.asAdmin,
      body: { location: 'Sample' },
    });
    const rows = await h.query('SELECT id FROM company_accounts WHERE candidate_id = $1', [
      candidate.id,
    ]);
    assert.equal(rows.length, 1);
    assert.deepEqual(await auditActions(h, 'company_accounts', accountId), [
      'COMPANY_ACCOUNT_REQUEST',
    ]);
  });

  test('IT marks Created with the company email, then HR marks Handed over', async () => {
    const { accountId, employeeId } = await attended('Account Sample 2');

    // Out of order is refused.
    const early = await h.api(`/company-accounts/${accountId}/handed-over`, {
      method: 'POST',
      cookie: hr.cookie,
      body: {},
    });
    assert.equal(early.status, 422);

    const bad = await h.api(`/company-accounts/${accountId}/created`, {
      method: 'POST',
      cookie: hr.cookie,
      body: { companyEmail: 'not-an-address', createdDate: '2026-02-30' },
    });
    assert.equal(bad.status, 422);
    assert.deepEqual(Object.keys(bad.body.fields).sort(), ['companyEmail', 'createdDate']);

    const created = await h.api(`/company-accounts/${accountId}/created`, {
      method: 'POST',
      cookie: hr.cookie,
      body: { companyEmail: ' Sample.Person@Example.test ', createdDate: '2026-10-14' },
    });
    assert.equal(created.status, 200, JSON.stringify(created.body));
    assert.equal(created.body.account.status, 'created');
    assert.equal(created.body.account.companyEmail, 'sample.person@example.test');
    assert.equal(created.body.account.createdDate, '2026-10-14');

    // Created cannot be repeated.
    assert.equal(
      (
        await h.api(`/company-accounts/${accountId}/created`, {
          method: 'POST',
          cookie: hr.cookie,
          body: { companyEmail: 'other@example.test' },
        })
      ).status,
      422,
    );

    const handed = await h.api(`/company-accounts/${accountId}/handed-over`, {
      method: 'POST',
      cookie: hr.cookie,
      body: { handedOverDate: '2026-10-15' },
    });
    assert.equal(handed.status, 200);
    assert.equal(handed.body.account.status, 'handed_over');
    assert.equal(handed.body.account.handedOverDate, '2026-10-15');

    const profile = await h.api(`/employees/${employeeId}`, h.asAdmin);
    assert.equal(profile.body.companyAccount.status, 'handed_over');
    assert.deepEqual(await auditActions(h, 'company_accounts', accountId), [
      'COMPANY_ACCOUNT_REQUEST',
      'COMPANY_ACCOUNT_CREATED',
      'COMPANY_ACCOUNT_HANDED_OVER',
    ]);
  });

  test('only people who manage company accounts may change a status', async () => {
    const { accountId } = await attended('Account Sample 3');
    for (const who of [teamLead, intern]) {
      const res = await h.api(`/company-accounts/${accountId}/created`, {
        method: 'POST',
        cookie: who.cookie,
        body: { companyEmail: 'x@example.test' },
      });
      assert.equal(res.status, 403);
    }
    assert.equal((await h.api('/company-accounts', { cookie: teamLead.cookie })).status, 403);
    assert.equal((await h.api('/company-accounts', { cookie: hr.cookie })).status, 200);
    assert.equal(await statusOf(accountId), 'requested');
  });

  test('discontinuing records a Disable action; completing it makes the account Disabled', async () => {
    const { accountId, employeeId } = await attended('Account Sample 4');
    await h.api(`/company-accounts/${accountId}/created`, {
      method: 'POST',
      cookie: hr.cookie,
      body: { companyEmail: 'leaver@example.test' },
    });

    // Disabling before anyone has left is refused.
    const early = await h.api(`/company-accounts/${accountId}/disabled`, {
      method: 'POST',
      cookie: hr.cookie,
      body: {},
    });
    assert.equal(early.status, 422);

    const left = await h.api(`/employees/${employeeId}/decision`, {
      method: 'POST',
      ...h.asAdmin,
      body: { result: 'discontinue', reason: 'Sample reason', exitDate: isoDay(inDays(1)) },
    });
    assert.equal(left.status, 200, JSON.stringify(left.body));
    assert.equal(left.body.companyAccount.status, 'created');
    assert.equal(left.body.companyAccount.disablePending, true);

    const done = await h.api(`/company-accounts/${accountId}/disabled`, {
      method: 'POST',
      cookie: hr.cookie,
      body: { disabledDate: isoDay(inDays(1)) },
    });
    assert.equal(done.status, 200);
    assert.equal(done.body.account.status, 'disabled');
    assert.equal(done.body.account.disablePending, false);
    assert.ok(
      (await auditActions(h, 'company_accounts', accountId)).includes(
        'COMPANY_ACCOUNT_DISABLE_REQUEST',
      ),
    );
  });

  test('terminating a senior employee also records the Disable action', async () => {
    const { accountId, employeeId } = await attended('Account Sample 5');
    await h.api(`/company-accounts/${accountId}/created`, {
      method: 'POST',
      cookie: hr.cookie,
      body: { companyEmail: 'senior@example.test' },
    });
    for (const body of [
      { result: 'pass' },
      { result: 'pass' },
      { result: 'pass', endDate: isoDay(inDays(400)) },
    ]) {
      const res = await h.api(`/employees/${employeeId}/decision`, {
        method: 'POST',
        ...h.asAdmin,
        body,
      });
      assert.equal(res.status, 200, JSON.stringify(res.body));
    }
    const ended = await h.api(`/employees/${employeeId}/termination`, {
      method: 'POST',
      ...h.asAdmin,
      body: { reason: 'Sample reason', exitDate: isoDay(inDays(450)) },
    });
    assert.equal(ended.status, 200, JSON.stringify(ended.body));
    assert.equal(ended.body.companyAccount.disablePending, true);
    assert.equal(await statusOf(accountId), 'created');
  });

  test('an account that was never created is closed at once when the employee leaves', async () => {
    const { accountId, employeeId } = await attended('Account Sample 6');
    await h.api(`/employees/${employeeId}/decision`, {
      method: 'POST',
      ...h.asAdmin,
      body: { result: 'discontinue', reason: 'Sample reason', exitDate: isoDay(inDays(1)) },
    });
    assert.equal(await statusOf(accountId), 'disabled');
  });
});

describe('the temporary password', () => {
  const PASSWORD = `Tmp-${randomBytes(6).toString('hex')}-Sample`;
  let accountId;
  let candidateId;

  before(async () => {
    const created = await attended('Password Sample');
    accountId = created.accountId;
    candidateId = created.candidate.id;
    await h.api(`/company-accounts/${accountId}/created`, {
      method: 'POST',
      cookie: hr.cookie,
      body: { companyEmail: 'password.sample@example.test' },
    });
  });

  test('only the Main User may keep, reveal, reset or delete it', async () => {
    for (const who of [hr, teamLead, intern]) {
      const calls = [
        ['PUT', `/company-accounts/${accountId}/password`, { password: PASSWORD }],
        ['POST', `/company-accounts/${accountId}/password/reset`],
        ['POST', `/company-accounts/${accountId}/password/reveal`, { loginPassword: who.password }],
        ['DELETE', `/company-accounts/${accountId}/password`],
      ];
      for (const [method, path, body] of calls) {
        const res = await h.api(path, { method, body, cookie: who.cookie });
        assert.equal(res.status, 403, `${who.email} ${method} ${path}`);
      }
    }
    assert.equal(await secretCount(accountId), 0);
  });

  test('is stored encrypted, never as plaintext', async () => {
    const set = await h.api(`/company-accounts/${accountId}/password`, {
      method: 'PUT',
      ...h.asAdmin,
      body: { password: PASSWORD },
    });
    assert.equal(set.status, 200, JSON.stringify(set.body));
    assert.equal(set.body.account.hasStoredPassword, true);
    assert.doesNotMatch(JSON.stringify(set.body), new RegExp(PASSWORD));

    const [secret] = await h.query('SELECT * FROM company_account_secrets WHERE account_id = $1', [
      accountId,
    ]);
    assert.equal(secret.iv.length, 12);
    assert.equal(secret.auth_tag.length, 16);
    assert.ok(!secret.ciphertext.includes(Buffer.from(PASSWORD)));
    assert.ok(!Buffer.from(KEY, 'base64').equals(secret.ciphertext));
  });

  test('is masked everywhere: lists, details, profile, audit, mail and notification tables', async () => {
    const employeeId = (
      await h.query('SELECT id FROM employees WHERE candidate_id = $1', [candidateId])
    )[0].id;
    const paths = [
      '/company-accounts',
      `/company-accounts/${accountId}`,
      `/employees/${employeeId}`,
      '/employees',
      '/admin/audit-log',
      '/email-log',
      '/notifications',
    ];
    for (const path of paths) {
      const res = await h.api(path, h.asAdmin);
      assert.equal(res.status, 200, path);
      assert.doesNotMatch(JSON.stringify(res.body), new RegExp(PASSWORD), path);
    }

    for (const table of [
      'audit_log',
      'email_log',
      'notifications',
      'company_accounts',
      'settings',
    ]) {
      const rows = await h.query(`SELECT row_to_json(t)::text AS j FROM ${table} t`);
      assert.doesNotMatch(JSON.stringify(rows), new RegExp(PASSWORD), table);
    }
  });

  test('is revealed only after the Main User re-enters their own login password, for 30 seconds', async () => {
    const wrong = await h.api(`/company-accounts/${accountId}/password/reveal`, {
      method: 'POST',
      ...h.asAdmin,
      body: { loginPassword: 'definitely-not-it' },
    });
    assert.equal(wrong.status, 422);
    assert.doesNotMatch(JSON.stringify(wrong.body), new RegExp(PASSWORD));

    const missing = await h.api(`/company-accounts/${accountId}/password/reveal`, {
      method: 'POST',
      ...h.asAdmin,
      body: {},
    });
    assert.equal(missing.status, 422);

    const ok = await h.api(`/company-accounts/${accountId}/password/reveal`, {
      method: 'POST',
      ...h.asAdmin,
      body: { loginPassword: h.admin.password },
    });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(ok.body.password, PASSWORD);
    assert.equal(ok.body.revealSeconds, 30);

    const actions = await auditActions(h, 'company_accounts', accountId);
    assert.ok(actions.includes('COMPANY_PASSWORD_REVEAL_DENIED'));
    assert.ok(actions.includes('COMPANY_PASSWORD_REVEAL'));
    assert.ok(actions.includes('COMPANY_PASSWORD_EDIT'));
  });

  test('a reset replaces it with a new random one and is logged', async () => {
    const reset = await h.api(`/company-accounts/${accountId}/password/reset`, {
      method: 'POST',
      ...h.asAdmin,
    });
    assert.equal(reset.status, 200, JSON.stringify(reset.body));
    assert.notEqual(reset.body.password, PASSWORD);
    assert.ok(reset.body.password.length >= 12);

    const revealed = await h.api(`/company-accounts/${accountId}/password/reveal`, {
      method: 'POST',
      ...h.asAdmin,
      body: { loginPassword: h.admin.password },
    });
    assert.equal(revealed.body.password, reset.body.password);
    assert.ok(
      (await auditActions(h, 'company_accounts', accountId)).includes('COMPANY_PASSWORD_RESET'),
    );
  });

  test('is deleted once the employee has changed it', async () => {
    assert.equal(await secretCount(accountId), 1);
    const cleared = await h.api(`/company-accounts/${accountId}/password`, {
      method: 'DELETE',
      ...h.asAdmin,
    });
    assert.equal(cleared.status, 200);
    assert.equal(cleared.body.account.hasStoredPassword, false);
    assert.equal(await secretCount(accountId), 0);
    assert.ok(
      (await auditActions(h, 'company_accounts', accountId)).includes('COMPANY_PASSWORD_DELETE'),
    );

    const gone = await h.api(`/company-accounts/${accountId}/password/reveal`, {
      method: 'POST',
      ...h.asAdmin,
      body: { loginPassword: h.admin.password },
    });
    assert.equal(gone.status, 422);
  });

  test('can only be kept for a created account, and a disabled account loses it', async () => {
    const fresh = await attended('Password Sample 2');
    const early = await h.api(`/company-accounts/${fresh.accountId}/password`, {
      method: 'PUT',
      ...h.asAdmin,
      body: { password: PASSWORD },
    });
    assert.equal(early.status, 422);

    await h.api(`/company-accounts/${fresh.accountId}/created`, {
      method: 'POST',
      cookie: hr.cookie,
      body: { companyEmail: 'p2@example.test' },
    });
    await h.api(`/company-accounts/${fresh.accountId}/password`, {
      method: 'PUT',
      ...h.asAdmin,
      body: { password: PASSWORD },
    });
    assert.equal(await secretCount(fresh.accountId), 1);

    await h.api(`/employees/${fresh.employeeId}/decision`, {
      method: 'POST',
      ...h.asAdmin,
      body: { result: 'discontinue', reason: 'Sample reason', exitDate: isoDay(inDays(1)) },
    });
    // The Disable action is recorded and the stored password is dropped.
    assert.equal(await secretCount(fresh.accountId), 0);
  });
});

describe('without an encryption key', () => {
  test('no password can be stored, and the answer says so without any detail', async () => {
    const bare = await startHarness();
    try {
      const position2 = await bare.lookup('positions', 'Bare Position');
      const candidate = await bare.newCandidate({ positionId: position2.id });
      await bare.joined(candidate, {
        positionId: position2.id,
        onboardingDate: isoDay(inDays(-3)),
      });
      const [account] = await bare.query('SELECT id FROM company_accounts');
      await bare.api(`/company-accounts/${account.id}/created`, {
        method: 'POST',
        ...bare.asAdmin,
        body: { companyEmail: 'bare@example.test' },
      });
      const res = await bare.api(`/company-accounts/${account.id}/password`, {
        method: 'PUT',
        ...bare.asAdmin,
        body: { password: 'anything-at-all' },
      });
      assert.equal(res.status, 503);
      assert.equal(res.body.error, 'secret_key_missing');
      assert.deepEqual(await bare.query('SELECT 1 FROM company_account_secrets'), []);
    } finally {
      await bare.stop();
    }
  });
});
