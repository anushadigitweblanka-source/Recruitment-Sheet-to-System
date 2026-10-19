import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { dryRun, executeImport } from '../src/modules/historical/importer.js';
import { startHarness } from './helpers/harness.js';

// Dashboard figures for Recruitment Records. Everything is fictional and lives
// in this file's own throwaway schema.

const HEADER = 'Date,Source,Name,Contact #,Mode,Position,Status,Remarks,,';
const LINES = [
  HEADER,
  '04/11/2026 14:30,Fictional Board,Hist Sample One,0771111111,Onsite,Sample Position A,Selected,First remark,,',
  '05/11/2026,Fictional Board,Hist Sample Two,0772222222,Online,Sample Position B,Selected,,,',
  '06/11/2026,Fictional Board,Hist Sample Three,0773333333,Onsite,Sample Position A,Rejected,,,',
  '07/11/2026,Referral,Hist Sample Four,0774444444,Onsite,Sample Position A,On Hold,,,',
  '03/04/2031,Referral,Hist Sample Five,0775555555,Onsite,Sample Position A,,,,',
];
const HISTORY = LINES.length - 1;

let h;
let hr;
let teamLead;
let intern;
let dir;

const summary = async (who = h.asAdmin) => h.api('/dashboard/summary', who);
const outcomeOf = (body, status) =>
  body.recruitmentRecords.historicalOutcomes.find((o) => o.status === status)?.count;
const tableCount = async (table) =>
  (await h.db.pool.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n;

before(async () => {
  h = await startHarness();
  hr = await h.signedIn({ roleCode: 'hr' });
  teamLead = await h.signedIn({ roleCode: 'team_lead' });
  intern = await h.signedIn({ roleCode: 'intern_dev' });
  dir = await mkdtemp(join(tmpdir(), 'dashboard-records-'));
  const csv = join(dir, 'fictional-interview-log.csv');
  await writeFile(csv, Buffer.from(LINES.join('\r\n'), 'latin1'));
  const plan = await dryRun(csv);
  await executeImport(h.db.pool, csv, { confirmSha: plan.fingerprint });
});

after(async () => {
  await rm(dir, { recursive: true, force: true });
  await h.stop();
});

describe('totals and outcomes from the database', () => {
  test('history only: total = historical records, outcomes keep the original status text', async () => {
    const res = await summary();
    assert.equal(res.status, 200);
    const records = res.body.recruitmentRecords;
    assert.equal(records.totalRecords, HISTORY);
    assert.equal(records.historicalInterviewRecords, HISTORY);
    assert.equal(records.currentCandidateProfiles, 0);
    assert.equal(outcomeOf(res.body, 'Selected'), 2);
    assert.equal(outcomeOf(res.body, 'Rejected'), 1);
    assert.equal(outcomeOf(res.body, 'On Hold'), 1);
    assert.equal(outcomeOf(res.body, null), 1, 'a blank status stays blank');
    assert.equal(
      records.historicalOutcomes.reduce((sum, o) => sum + o.count, 0),
      HISTORY,
      'every record is in exactly one outcome',
    );
  });

  test('history is NOT counted as candidates or as live pipeline stages', async () => {
    const { counts } = (await summary()).body;
    assert.equal(counts.totalCandidates, 0);
    for (const key of ['applied', 'selected', 'rejected', 'onHold', 'interviewed', 'joined']) {
      assert.equal(counts[key], 0, key);
    }
    assert.equal(counts.currentlyWorking, 0);
  });

  test('the same numbers as the Recruitment Records list', async () => {
    const list = await h.api('/recruitment-records?pageSize=1', h.asAdmin);
    assert.equal(list.body.total, (await summary()).body.recruitmentRecords.totalRecords);
  });
});

describe('Add Candidate and status changes update the Dashboard', () => {
  let candidate;

  test('a new candidate raises the profile and total counts, and the live Applied stage', async () => {
    const before = (await summary()).body;
    candidate = await h.newCandidate({ fullName: 'Dashboard Sample Alice' });
    const after = (await summary()).body;

    assert.equal(after.recruitmentRecords.currentCandidateProfiles, 1);
    assert.equal(after.recruitmentRecords.totalRecords, before.recruitmentRecords.totalRecords + 1);
    assert.equal(after.counts.totalCandidates, 1);
    assert.equal(after.counts.applied, 1);
    // The history did not move.
    assert.equal(after.recruitmentRecords.historicalInterviewRecords, HISTORY);
    assert.deepEqual(
      after.recruitmentRecords.historicalOutcomes,
      before.recruitmentRecords.historicalOutcomes,
    );
  });

  test('a status change moves the live pipeline figures, never the historical outcomes', async () => {
    const before = (await summary()).body;
    await h.phoneSelected(candidate);
    const after = (await summary()).body;

    assert.equal(after.counts.applied, 0);
    const movedInto = Object.keys(after.counts).filter(
      (key) => after.counts[key] > before.counts[key],
    );
    assert.equal(movedInto.length, 1, `exactly one stage gained the candidate: ${movedInto}`);
    assert.equal(after.counts.totalCandidates, 1);
    assert.equal(after.recruitmentRecords.totalRecords, before.recruitmentRecords.totalRecords);
    assert.deepEqual(
      after.recruitmentRecords.historicalOutcomes,
      before.recruitmentRecords.historicalOutcomes,
    );
  });
});

describe('upcoming interviews and employees keep their own sources', () => {
  test('historical interview dates are never upcoming interviews', async () => {
    // Several historical records are dated after "now" in the fixture (2026-11, 2031),
    // so they would be "upcoming" if the dashboard ever read them. It does not.
    const scheduled = await h.newCandidate({ fullName: 'Dashboard Sample Bob' });
    await h.phoneSelected(scheduled);
    const interview = await h.directInterview(scheduled);
    assert.equal(interview.status, 201, JSON.stringify(interview.body));

    const body = (await summary()).body;
    // The candidate is listed once; others waiting at Interview Scheduled with a
    // future phone-interview slot may be listed too, but never a historical record.
    const codes = body.upcomingInterviews.map((i) => i.candidateCode);
    assert.equal(codes.filter((code) => code === scheduled.candidateCode).length, 1);
    assert.ok(
      codes.every((code) => code !== null),
      'every row is a live candidate',
    );
    const names = body.upcomingInterviews.map((i) => i.candidateName);
    assert.ok(
      names.every((n) => !n.startsWith('Hist Sample')),
      JSON.stringify(names),
    );
    // Only live candidates appear: recorded interviews plus waiting phone slots.
    const live = (
      await h.db.pool.query(
        `SELECT (SELECT count(*) FROM interviews WHERE scheduled_at >= now())
              + (SELECT count(*) FROM pipeline_status ps
                  WHERE ps.current_stage = 'interview_scheduled'
                    AND NOT EXISTS (SELECT 1 FROM interviews i WHERE i.candidate_id = ps.candidate_id)
                    AND EXISTS (SELECT 1 FROM phone_screens x WHERE x.candidate_id = ps.candidate_id
                                  AND x.interview_datetime >= now()))::int AS n`,
      )
    ).rows[0].n;
    assert.equal(body.upcomingInterviews.length, Math.min(Number(live), 10));
    assert.ok(Number(live) >= 1, 'the live interview made by the previous test is listed');
  });

  test('employee lifecycle figures do not include any historical record', async () => {
    const body = (await summary()).body;
    assert.equal(body.counts.currentlyWorking, await tableCount('employees'));
    assert.deepEqual(body.employeePhases, { evaluation: 0, probation: 0, junior: 0, senior: 0 });
  });
});

describe('who sees what', () => {
  test('Main User and HR get the record figures', async () => {
    assert.ok((await summary()).body.recruitmentRecords);
    assert.ok((await summary({ cookie: hr.cookie })).body.recruitmentRecords);
  });

  test('a user without historical.view gets the unchanged live answer only', async () => {
    const res = await summary({ cookie: intern.cookie });
    assert.equal(res.status, 200);
    assert.equal('recruitmentRecords' in res.body, false);
    assert.deepEqual(Object.keys(res.body).sort(), [
      'counts',
      'employeePhases',
      'upcomingDeadlines',
      'upcomingInterviews',
    ]);
    // Without the record figures the live counts are still the live counts.
    assert.equal(res.body.counts.totalCandidates, await tableCount('candidates'));
  });

  test('Team Lead and signed-out callers are refused', async () => {
    assert.equal((await summary({ cookie: teamLead.cookie })).status, 403);
    assert.equal((await summary({})).status, 401);
  });

  test('the answer carries counts only: no names, phones, remarks, salary or credentials', async () => {
    const text = JSON.stringify((await summary()).body);
    for (const value of ['Hist Sample', '0771111111', 'First remark', 'Fictional Board']) {
      assert.ok(!text.includes(value), `${value} must not be in the dashboard answer`);
    }
    assert.ok(!/salary|password|hash|secret|token/i.test(text));
  });
});

describe('reading the dashboard changes nothing', () => {
  test('no table gains, loses or changes a row', async () => {
    const tables = [
      'candidates',
      'historical_interview_records',
      'historical_import_batches',
      'stage_history',
      'offers',
      'employees',
      'interviews',
      'notifications',
    ];
    const snap = async () =>
      Object.fromEntries(
        await Promise.all(
          tables.map(async (t) => [
            t,
            (
              await h.db.pool.query(
                `SELECT count(*)::int AS n, md5(coalesce(string_agg(x::text, ',' ORDER BY x::text), '')) AS h FROM ${t} x`,
              )
            ).rows[0],
          ]),
        ),
      );
    const before = await snap();
    for (let i = 0; i < 3; i += 1) await summary();
    assert.deepEqual(await snap(), before);
  });
});
