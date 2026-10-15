import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { auditActions, startHarness } from './helpers/harness.js';

// Stage 11: the guide's four roles, their permissions, and the Team Lead
// mapping that limits a Team Lead to their own team. IMPLEMENTED_FROM_TASK_GUIDE.
// All names and addresses are made up.

let h;
let hr;
let teamLead;
let teamLeadOther;
let intern;
let posA;
let posB;
let candA;
let candB;

before(async () => {
  h = await startHarness();
  hr = await h.signedIn({ roleCode: 'hr' });
  teamLead = await h.signedIn({ roleCode: 'team_lead' });
  teamLeadOther = await h.signedIn({ roleCode: 'team_lead' });
  intern = await h.signedIn({ roleCode: 'intern_dev' });

  posA = await h.lookup('positions', 'Sample Position A');
  posB = await h.lookup('positions', 'Sample Position B');
  candA = await h.newCandidate({ positionId: posA.id, fullName: 'Team A Sample' });
  candB = await h.newCandidate({ positionId: posB.id, fullName: 'Team B Sample' });

  for (const [position, who, name, email] of [
    [posA, teamLead, 'Sample Lead A', 'lead.a@example.test'],
    [posB, teamLeadOther, 'Sample Lead B', 'lead.b@example.test'],
  ]) {
    const res = await h.api('/admin/team-leads', {
      method: 'POST',
      ...h.asAdmin,
      body: { positionId: position.id, name, email, userId: who.id },
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
  }
});

after(async () => {
  await h.stop();
});

describe('the roles from the guide', () => {
  test('Main User, HR, Team Lead and Intern / Dev exist with exactly their permissions', async () => {
    const rows = await h.query(
      `SELECT r.code, array_agg(p.code ORDER BY p.code) AS permissions
         FROM roles r
         JOIN role_permissions rp ON rp.role_id = r.id
         JOIN permissions p ON p.id = rp.permission_id
        GROUP BY r.code`,
    );
    const byRole = Object.fromEntries(rows.map((row) => [row.code, row.permissions]));

    assert.deepEqual(byRole.hr, [
      'candidates.edit',
      'candidates.view',
      'company_accounts.manage',
      'interviews.manage',
      'notifications.manage',
    ]);
    assert.deepEqual(byRole.team_lead, ['candidates.view_team', 'interviews.score']);
    assert.deepEqual(byRole.intern_dev, [
      'candidates.edit',
      'candidates.view',
      'employees.manage',
      'interviews.manage',
      'notifications.manage',
      'offers.manage',
    ]);
    assert.ok(byRole.main_user.includes('salary.view'));
    assert.ok(byRole.main_user.includes('salary.edit'));
    assert.ok(byRole.main_user.includes('admin.manage'));
    assert.ok(byRole.main_user.includes('company_accounts.password'));
  });

  test('only the Main User holds a salary permission', async () => {
    const rows = await h.query(
      `SELECT DISTINCT r.code FROM role_permissions rp
         JOIN roles r ON r.id = rp.role_id JOIN permissions p ON p.id = rp.permission_id
        WHERE p.code IN ('salary.view', 'salary.edit')`,
    );
    assert.deepEqual(
      rows.map((row) => row.code),
      ['main_user'],
    );
  });

  test('only the Main User may reveal company passwords or manage users and settings', async () => {
    for (const who of [hr, teamLead, intern]) {
      assert.equal((await h.api('/admin/users', { cookie: who.cookie })).status, 403);
      assert.equal((await h.api('/admin/settings', { cookie: who.cookie })).status, 403);
      assert.equal(
        (
          await h.api('/company-accounts/1/password/reveal', {
            method: 'POST',
            cookie: who.cookie,
            body: { loginPassword: 'x' },
          })
        ).status,
        403,
      );
    }
  });
});

describe('HR', () => {
  test('sees all candidates and adds and edits candidates', async () => {
    const list = await h.api('/candidates', { cookie: hr.cookie });
    assert.equal(list.status, 200);
    assert.ok(list.body.total >= 2);

    const created = await h.api('/candidates', {
      method: 'POST',
      cookie: hr.cookie,
      body: { candidateCode: 'S11-HR-1', fullName: 'Added By HR', phone: '0761234500' },
    });
    assert.equal(created.status, 201);
    const edited = await h.api(`/candidates/${created.body.candidate.id}`, {
      method: 'PUT',
      cookie: hr.cookie,
      body: { candidateCode: 'S11-HR-1', fullName: 'Edited By HR', phone: '0761234500' },
    });
    assert.equal(edited.status, 200);
  });

  test('enters interview results and may send mail, but sees no salary and no administration', async () => {
    const candidate = await h.newCandidate({ positionId: posA.id });
    const phone = await h.api('/phone-interviews', {
      method: 'POST',
      cookie: hr.cookie,
      body: {
        candidateId: candidate.id,
        called: true,
        result: 'not_selected',
        rejectReason: 'Sample',
      },
    });
    assert.equal(phone.status, 201, JSON.stringify(phone.body));

    // Sending mail: the preview route is open to HR (no template exists yet,
    // which is reported, not a permission failure).
    const preview = await h.api(`/candidates/${candidate.id}/emails/preview`, {
      method: 'POST',
      cookie: hr.cookie,
      body: { type: 'interview_invitation' },
    });
    assert.notEqual(preview.status, 403);

    assert.equal((await h.api(`/salary/${candidate.id}`, { cookie: hr.cookie })).status, 403);
    assert.equal(
      (
        await h.api(`/salary/${candidate.id}`, {
          method: 'PUT',
          cookie: hr.cookie,
          body: { salaryLkr: 1 },
        })
      ).status,
      403,
    );
    assert.equal((await h.api('/admin/audit-log', { cookie: hr.cookie })).status, 403);
  });
});

describe('Team Lead', () => {
  test('sees only the candidates of their own team', async () => {
    const list = await h.api('/candidates', { cookie: teamLead.cookie });
    assert.equal(list.status, 200);
    const codes = list.body.items.map((item) => item.fullName);
    assert.ok(codes.includes('Team A Sample'));
    assert.ok(!codes.includes('Team B Sample'));

    assert.equal((await h.api(`/candidates/${candA.id}`, { cookie: teamLead.cookie })).status, 200);
    assert.equal((await h.api(`/candidates/${candB.id}`, { cookie: teamLead.cookie })).status, 404);

    const other = await h.api('/candidates', { cookie: teamLeadOther.cookie });
    const otherNames = other.body.items.map((item) => item.fullName);
    assert.ok(otherNames.includes('Team B Sample'));
    assert.ok(!otherNames.includes('Team A Sample'));
  });

  test('sees their team on the interview screens, and nothing of another team', async () => {
    await h.phoneSelected(candA);
    await h.phoneSelected(candB);

    const list = await h.api('/interviews', { cookie: teamLead.cookie });
    assert.equal(list.status, 200);
    const names = list.body.items.map((item) => item.candidate.fullName);
    assert.ok(names.includes('Team A Sample'));
    assert.ok(!names.includes('Team B Sample'));
  });

  test('adds interview scores for their own team only', async () => {
    const own = await h.api('/interviews', {
      method: 'POST',
      cookie: teamLead.cookie,
      body: {
        candidateId: candA.id,
        scheduledAt: new Date(Date.now() + 3 * 86400000).toISOString(),
        attendance: 'attended',
        scoreTechnical: 7,
        scoreAi: 7,
        scoreCommunication: 7,
        scoreConfidence: 7,
        scoreCultureFit: 7,
        remarks: 'Sample comment',
      },
    });
    assert.equal(own.status, 201, JSON.stringify(own.body));

    const foreign = await h.api('/interviews', {
      method: 'POST',
      cookie: teamLead.cookie,
      body: {
        candidateId: candB.id,
        scheduledAt: new Date(Date.now() + 3 * 86400000).toISOString(),
      },
    });
    assert.equal(foreign.status, 403);

    // Another team's interview cannot be opened or edited either.
    const mine = own.body.interview.id;
    assert.equal(
      (await h.api(`/interviews/${mine}`, { cookie: teamLeadOther.cookie })).status,
      404,
    );
    assert.equal(
      (
        await h.api(`/interviews/${mine}`, {
          method: 'PATCH',
          cookie: teamLeadOther.cookie,
          body: { remarks: 'Not mine' },
        })
      ).status,
      403,
    );
  });

  test('has no salary, no candidate editing and none of the other screens', async () => {
    const forbidden = [
      ['GET', `/salary/${candA.id}`],
      ['GET', '/dashboard/summary'],
      ['GET', '/reports/weekly'],
      ['GET', '/offers'],
      ['GET', '/employees'],
      ['GET', '/notifications'],
      ['GET', '/email-log'],
      ['GET', '/phone-interviews'],
      ['GET', '/admin/team-leads'],
    ];
    for (const [method, path] of forbidden) {
      const res = await h.api(path, { method, cookie: teamLead.cookie });
      assert.equal(res.status, 403, `${method} ${path}`);
    }
    const create = await h.api('/candidates', {
      method: 'POST',
      cookie: teamLead.cookie,
      body: { candidateCode: 'S11-TL-X', fullName: 'Nope', phone: '0761234599' },
    });
    assert.equal(create.status, 403);
  });
});

describe('Intern / Dev', () => {
  test('works with test data but has no salary and no administration', async () => {
    assert.equal((await h.api('/candidates', { cookie: intern.cookie })).status, 200);
    assert.equal((await h.api(`/salary/${candA.id}`, { cookie: intern.cookie })).status, 403);
    assert.equal((await h.api('/admin/settings', { cookie: intern.cookie })).status, 403);
  });
});

describe('the Team Lead mapping', () => {
  test('is managed by the Main User only and validated', async () => {
    assert.equal((await h.api('/admin/team-leads', { cookie: hr.cookie })).status, 403);
    const list = await h.api('/admin/team-leads', h.asAdmin);
    assert.equal(list.status, 200);
    assert.equal(list.body.items.length, 2);
    assert.equal(list.body.items[0].position.name, 'Sample Position A');

    const bad = await h.api('/admin/team-leads', {
      method: 'POST',
      ...h.asAdmin,
      body: { positionId: 999999, name: '', email: 'not-an-address' },
    });
    assert.equal(bad.status, 422);
    assert.deepEqual(Object.keys(bad.body.fields).sort(), ['email', 'name', 'positionId']);
  });

  test('allows one Team Lead per position, and edits are audited', async () => {
    const duplicate = await h.api('/admin/team-leads', {
      method: 'POST',
      ...h.asAdmin,
      body: { positionId: posA.id, name: 'Second Lead', email: 'second.lead@example.test' },
    });
    assert.equal(duplicate.status, 422);
    assert.match(duplicate.body.fields.positionId, /already has a Team Lead/);

    const first = (await h.api('/admin/team-leads', h.asAdmin)).body.items[0];
    const edit = await h.api(`/admin/team-leads/${first.id}`, {
      method: 'PATCH',
      ...h.asAdmin,
      body: { teamName: 'Sample Team' },
    });
    assert.equal(edit.status, 200);
    assert.equal(edit.body.teamLead.teamName, 'Sample Team');
    assert.deepEqual(await auditActions(h, 'team_leads', first.id), [
      'TEAM_LEAD_CREATE',
      'TEAM_LEAD_UPDATE',
    ]);
    assert.equal(
      (await h.api('/admin/team-leads/999999', { method: 'PATCH', ...h.asAdmin, body: {} })).status,
      404,
    );
  });

  test('a deactivated Team Lead no longer sees the team', async () => {
    const lead = (await h.api('/admin/team-leads', h.asAdmin)).body.items.find(
      (item) => item.position.id === posB.id,
    );
    await h.api(`/admin/team-leads/${lead.id}`, {
      method: 'PATCH',
      ...h.asAdmin,
      body: { isActive: false },
    });
    const list = await h.api('/candidates', { cookie: teamLeadOther.cookie });
    assert.equal(list.body.total, 0);
  });
});
