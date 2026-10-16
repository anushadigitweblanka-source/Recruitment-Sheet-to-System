import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { dryRun, executeImport } from '../src/modules/historical/importer.js';
import { startHarness } from './helpers/harness.js';

// Historical Selected records on the Employee Lifecycle dashboard. These are
// interview-log entries, not employees. Everything is fictional and lives in
// this file's own throwaway schema.

const HEADER = 'Date,Source,Name,Contact #,Mode,Position,Status,Remarks,,';
const LINES = [
  HEADER,
  '04/11/2026 14:30,Fictional Board,Hist Sample One,0771111111,Onsite,Sample Position A,Selected,First remark,,',
  '05/11/2026,Fictional Board,Hist Sample Two,0772222222,Online,Sample Position B,Selected,,,',
  '06/11/2026,Referral,Hist Sample Three,0773333333,Onsite,Sample Position A,Selected,Third remark,,',
  '07/11/2026,Referral,Hist Sample Four,0774444444,Onsite,Sample Position A,Rejected,,,',
  '08/11/2026,Referral,Hist Sample Five,0775555555,Onsite,Sample Position A,On Hold,,,',
  '09/11/2026,Referral,Hist Sample Six,0776666666,Onsite,Sample Position A,Not Selected,,,',
  '10/11/2026,Referral,Hist Sample Seven,0777777777,Onsite,Sample Position A,,,,',
];
const SELECTED = 3;
const HISTORY = LINES.length - 1;

let h;
let hr;
let teamLead;
let intern;
let dir;

const selectedList = (query = '', who = h.asAdmin) =>
  h.api(`/historical-interviews?status=Selected&pageSize=100${query}`, who);
const count = async (sql, params = []) => (await h.db.pool.query(sql, params)).rows[0].n;

before(async () => {
  h = await startHarness();
  hr = await h.signedIn({ roleCode: 'hr' });
  teamLead = await h.signedIn({ roleCode: 'team_lead' });
  intern = await h.signedIn({ roleCode: 'intern_dev' });
  dir = await mkdtemp(join(tmpdir(), 'historical-selected-'));
  const csv = join(dir, 'fictional-interview-log.csv');
  await writeFile(csv, Buffer.from(LINES.join('\r\n'), 'latin1'));
  const plan = await dryRun(csv);
  await executeImport(h.db.pool, csv, { confirmSha: plan.fingerprint });
});

after(async () => {
  await rm(dir, { recursive: true, force: true });
  await h.stop();
});

describe('the Selected count comes from the database', () => {
  test('matches a direct SQL count of original_status = Selected, not a fixed number', async () => {
    const sql = await count(
      `SELECT count(*)::int AS n FROM historical_interview_records r
         JOIN historical_import_batches b ON b.id = r.batch_id
        WHERE b.status = 'completed' AND r.original_status = 'Selected'`,
    );
    assert.equal(sql, SELECTED);
    const res = await selectedList();
    assert.equal(res.status, 200);
    assert.equal(res.body.total, sql);
    assert.equal(res.body.items.length, sql);
  });

  test('only the exact status Selected: not Not Selected, Rejected, On Hold or blank', async () => {
    const res = await selectedList();
    assert.ok(res.body.items.every((i) => i.originalStatus === 'Selected'));
    assert.ok(!res.body.items.some((i) => i.candidateName === 'Hist Sample Six'));
  });

  test('every field asked for is returned exactly as imported', async () => {
    const one = (await selectedList('&search=Hist%20Sample%20One')).body.items[0];
    assert.equal(one.candidateName, 'Hist Sample One');
    assert.equal(one.contactNumber, '0771111111');
    assert.equal(one.position, 'Sample Position A');
    assert.equal(one.interviewDateText, '04/11/2026 14:30');
    assert.equal(one.originalStatus, 'Selected');
    assert.equal(one.remarks, 'First remark');
    assert.equal(one.recordNumber, 2);
  });

  test('search, position, source and mode narrow the Selected records; paging works', async () => {
    assert.equal((await selectedList('&search=Sample%20Two')).body.total, 1);
    assert.equal((await selectedList('&search=0773333333')).body.total, 1);
    assert.equal((await selectedList('&search=Third%20remark')).body.total, 1);
    assert.equal((await selectedList('&position=Sample%20Position%20A')).body.total, 2);
    assert.equal((await selectedList('&source=Referral')).body.total, 1);
    assert.equal((await selectedList('&mode=Online')).body.total, 1);
    assert.equal((await selectedList('&position=Sample%20Position%20B&mode=Onsite')).body.total, 0);
    const paged = await h.api(
      '/historical-interviews?status=Selected&pageSize=2&page=2',
      h.asAdmin,
    );
    assert.equal(paged.body.total, SELECTED);
    assert.equal(paged.body.items.length, 1);
  });

  test('filter options can be limited to the Selected records, with matching counts', async () => {
    const limited = (await h.api('/historical-interviews/options?status=Selected', h.asAdmin)).body;
    const total = (list) => list.reduce((sum, o) => sum + o.count, 0);
    assert.equal(total(limited.positions), SELECTED);
    assert.equal(total(limited.sources), SELECTED);
    assert.equal(total(limited.modes), SELECTED);
    assert.deepEqual(limited.statuses, [{ value: 'Selected', count: SELECTED }]);
    // Without the limit nothing changes: every record is counted.
    const all = (await h.api('/historical-interviews/options', h.asAdmin)).body;
    assert.equal(total(all.positions), HISTORY);
  });
});

describe('Selected interview records are not employees', () => {
  test('importing and viewing them created no employee, offer, notification, candidate or email', async () => {
    for (const table of [
      'employees',
      'offers',
      'notifications',
      'candidates',
      'email_log',
      'phase_history',
    ]) {
      assert.equal(await count(`SELECT count(*)::int AS n FROM ${table}`), 0, table);
    }
    await selectedList();
    const summary = (await h.api('/dashboard/summary', h.asAdmin)).body;
    assert.equal(summary.counts.currentlyWorking, 0);
    assert.equal(summary.counts.joined, 0);
    assert.equal(summary.counts.selected, 0, 'historical Selected is not the live Selected stage');
    assert.deepEqual(summary.employeePhases, { evaluation: 0, probation: 0, junior: 0, senior: 0 });
    assert.equal(summary.recruitmentRecords.historicalInterviewRecords, HISTORY);
  });

  test('a live candidate at the Selected stage is a separate count from the Selected interview records', async () => {
    const candidate = await h.newCandidate({ fullName: 'Selected Sample Alice' });
    await h.phoneSelected(candidate);
    const interview = await h.directInterview(
      candidate,
      new Date(Date.now() + 2 * 24 * 3600 * 1000),
      {
        attendance: 'attended',
        scoreTechnical: 8,
        scoreAi: 7,
        scoreCommunication: 9,
        scoreConfidence: 6,
        scoreCultureFit: 10,
        decision: 'selected',
      },
    );
    assert.equal(interview.status, 201, JSON.stringify(interview.body));

    const summary = (await h.api('/dashboard/summary', h.asAdmin)).body;
    assert.equal(summary.counts.selected, 1, 'the live pipeline now has one Selected candidate');
    assert.equal((await selectedList()).body.total, SELECTED, 'the interview records did not move');
    assert.equal(
      await count('SELECT count(*)::int AS n FROM employees'),
      0,
      'no employee was made',
    );
    assert.equal(await count('SELECT count(*)::int AS n FROM offers'), 0, 'no offer was made');
  });

  test('the historical records stay read only', async () => {
    const before = await count('SELECT count(*)::int AS n FROM historical_interview_records');
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const res = await h.api('/historical-interviews/1', {
        ...h.asAdmin,
        method,
        body: { originalStatus: 'Rejected' },
      });
      assert.ok(res.status >= 400 && res.status < 500, `${method} ${res.status}`);
    }
    assert.equal(
      await count('SELECT count(*)::int AS n FROM historical_interview_records'),
      before,
    );
    assert.equal((await selectedList()).body.total, SELECTED);
  });
});

describe('verified employees keep their own lifecycle pages', () => {
  test('a verified employee appears in its real phase, and the Selected history adds nothing', async () => {
    const position = await h.lookup('positions', 'Sample Position A');
    const candidate = await h.newCandidate({
      fullName: 'Verified Sample Bob',
      positionId: position.id,
    });
    const { employeeId } = await h.joined(candidate, { positionId: position.id });

    const stored = (
      await h.db.pool.query('SELECT current_phase, status FROM employees WHERE id = $1', [
        employeeId,
      ])
    ).rows[0];
    assert.deepEqual(stored, { current_phase: 'evaluation', status: 'active' });

    // Evaluation page = stored phase; the other phase pages and exits stay empty.
    const evaluation = await h.api('/employees?phase=evaluation&status=active', h.asAdmin);
    assert.deepEqual(
      evaluation.body.items.map((e) => e.id),
      [employeeId],
    );
    for (const phase of ['probation', 'junior', 'senior']) {
      assert.equal(
        (await h.api(`/employees?phase=${phase}&status=active`, h.asAdmin)).body.total,
        0,
      );
    }
    assert.equal((await h.api('/employees?status=exited', h.asAdmin)).body.total, 0);

    // The employee list holds only verified employees: not the 3 Selected interview records.
    const all = await h.api('/employees', h.asAdmin);
    assert.equal(all.body.total, 1);
    assert.equal(
      all.body.items.some((e) => String(e.candidate.fullName).startsWith('Hist Sample')),
      false,
    );
    assert.equal((await selectedList()).body.total, SELECTED, 'the interview records did not move');

    const summary = (await h.api('/dashboard/summary', h.asAdmin)).body;
    assert.equal(summary.counts.currentlyWorking, 1);
    assert.deepEqual(summary.employeePhases, { evaluation: 1, probation: 0, junior: 0, senior: 0 });
  });

  test('the employee lists are read from the database each time and never create anything', async () => {
    const tables = ['employees', 'offers', 'notifications', 'email_log', 'phase_history'];
    const snapshot = async () =>
      Object.fromEntries(
        await Promise.all(
          tables.map(async (t) => [t, await count(`SELECT count(*)::int AS n FROM ${t}`)]),
        ),
      );
    const before = await snapshot();
    for (let i = 0; i < 3; i += 1) {
      await h.api('/employees', h.asAdmin);
      await selectedList();
    }
    assert.deepEqual(await snapshot(), before);
    assert.equal(
      await count('SELECT count(*)::int AS n FROM historical_interview_records'),
      HISTORY,
    );
  });
});

describe('who may see them', () => {
  test('Main User and HR can; Team Lead and Intern get 403; signed-out 401', async () => {
    assert.equal((await selectedList()).status, 200);
    assert.equal((await selectedList('', { cookie: hr.cookie })).status, 200);
    assert.equal((await selectedList('', { cookie: teamLead.cookie })).status, 403);
    assert.equal((await selectedList('', { cookie: intern.cookie })).status, 403);
    assert.equal((await selectedList('', {})).status, 401);
    const options = (cookie) =>
      h.api('/historical-interviews/options?status=Selected', cookie ? { cookie } : {});
    assert.equal((await options(intern.cookie)).status, 403);
    assert.equal((await options(teamLead.cookie)).status, 403);
    assert.equal((await options()).status, 401);
  });

  test('the dashboard summary exposes no historical personal data or salary to anyone', async () => {
    for (const who of [h.asAdmin, { cookie: hr.cookie }, { cookie: intern.cookie }]) {
      const text = JSON.stringify((await h.api('/dashboard/summary', who)).body);
      for (const value of ['Hist Sample', '0771111111', 'First remark']) {
        assert.ok(!text.includes(value), value);
      }
      assert.ok(!/salary/i.test(text));
    }
  });
});
