import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { dryRun, executeImport } from '../src/modules/historical/importer.js';
import { startHarness } from './helpers/harness.js';

// Recruitment Records: one list of the imported history and the live
// candidates. Everything is fictional and lives in this file's own throwaway
// schema.

const HEADER = 'Date,Source,Name,Contact #,Mode,Position,Status,Remarks,,';
const LINES = [
  HEADER,
  '04/11/2026 14:30,Fictional Board,Hist Sample One,0771111111,Onsite,Sample Position A,Selected,First remark,,extra one',
  '05/11/2026,Fictional Board,Hist Sample Two,0772222222,Online,Sample Position B,Rejected,Second remark,,',
  ',Referral,Hist Sample Three,0773333333,Onsite,,,,,',
];
const HISTORY = LINES.length - 1;

let h;
let hr;
let teamLead;
let intern;
let dir;
let posA;
let posB;
let srcA;
let srcB;
let alice;
let bob;

const get = (path = '', who = h.asAdmin) => h.api(`/recruitment-records${path}`, who);
const count = async (sql, params = []) => (await h.db.pool.query(sql, params)).rows[0].n;
const names = (res) => res.body.items.map((i) => i.candidateName).sort();

before(async () => {
  h = await startHarness();
  hr = await h.signedIn({ roleCode: 'hr' });
  teamLead = await h.signedIn({ roleCode: 'team_lead' });
  intern = await h.signedIn({ roleCode: 'intern_dev' });
  posA = await h.lookup('positions', 'Sample Position A');
  posB = await h.lookup('positions', 'Sample Position B');
  srcA = await h.lookup('sources', 'Fictional Board');
  srcB = await h.lookup('sources', 'Sample Source B');

  dir = await mkdtemp(join(tmpdir(), 'records-fixture-'));
  const csv = join(dir, 'fictional-interview-log.csv');
  await writeFile(csv, Buffer.from(LINES.join('\r\n'), 'latin1'));
  const plan = await dryRun(csv);
  await executeImport(h.db.pool, csv, { confirmSha: plan.fingerprint });
});

after(async () => {
  await rm(dir, { recursive: true, force: true });
  await h.stop();
});

describe('one list of history and candidates', () => {
  test('before any candidate exists it lists only the history, exactly as imported', async () => {
    const res = await get('?pageSize=100');
    assert.equal(res.status, 200);
    assert.equal(res.body.total, HISTORY);
    assert.ok(res.body.items.every((i) => i.kind === 'historical'));
    const one = res.body.items.find((i) => i.candidateName === 'Hist Sample One');
    assert.equal(one.candidateId, null, 'no Candidate ID is invented');
    assert.equal(one.contactNumber, '0771111111');
    assert.equal(one.date, '04/11/2026 14:30');
    assert.equal(one.position, 'Sample Position A');
    assert.equal(one.source, 'Fictional Board');
    assert.equal(one.mode, 'Onsite');
    assert.equal(one.status, 'Selected');
    assert.equal(one.remarks, 'First remark');
  });

  test('Add Candidate appears in the same list with its generated Candidate ID', async () => {
    alice = await h.newCandidate({
      fullName: 'Registration Sample Alice',
      phone: '0761234567',
      positionId: posA.id,
      sourceId: srcA.id,
    });
    const res = await get('?pageSize=100');
    assert.equal(res.body.total, HISTORY + 1);
    const row = res.body.items.find((i) => i.kind === 'candidate');
    assert.equal(row.id, alice.id);
    assert.equal(row.candidateId, alice.candidateCode);
    assert.equal(row.candidateName, 'Registration Sample Alice');
    assert.equal(row.contactNumber, '0761234567');
    assert.equal(row.position, 'Sample Position A');
    assert.equal(row.source, 'Fictional Board');
    assert.match(row.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(row.status, 'Applied');
    // New registrations are listed first, ahead of the history.
    assert.equal(res.body.items[0].kind, 'candidate');
  });

  test('it is the same candidate as in the candidate API, saved once, and nothing is fabricated', async () => {
    const list = await h.api('/candidates?pageSize=100', h.asAdmin);
    assert.ok(list.body.items.some((c) => c.id === alice.id));
    assert.equal(await count('SELECT count(*)::int AS n FROM candidates'), 1);
    assert.equal(
      await count('SELECT count(*)::int AS n FROM historical_interview_records'),
      HISTORY,
      'no interview record was created for the candidate',
    );
    assert.deepEqual(
      (
        await h.db.pool.query(
          `SELECT from_stage, to_stage FROM stage_history WHERE candidate_id = $1`,
          [alice.id],
        )
      ).rows,
      [{ from_stage: null, to_stage: 'applied' }],
    );
  });

  test('reading never creates or duplicates anything', async () => {
    const before = [
      await count('SELECT count(*)::int AS n FROM stage_history'),
      await count('SELECT count(*)::int AS n FROM historical_interview_records'),
    ];
    for (let i = 0; i < 3; i += 1) assert.equal((await get()).body.total, HISTORY + 1);
    assert.deepEqual(
      [
        await count('SELECT count(*)::int AS n FROM stage_history'),
        await count('SELECT count(*)::int AS n FROM historical_interview_records'),
      ],
      before,
    );
  });

  test('registering the same Candidate ID again is refused and adds no second row', async () => {
    const res = await h.api('/candidates', {
      method: 'POST',
      ...h.asAdmin,
      body: {
        candidateCode: alice.candidateCode.toLowerCase(),
        fullName: 'Registration Duplicate',
      },
    });
    assert.ok(res.status >= 400 && res.status < 500, String(res.status));
    assert.equal((await get()).body.total, HISTORY + 1);
  });

  test('a status change shows in the list and matches the candidate timeline', async () => {
    bob = await h.newCandidate({
      fullName: 'Registration Sample Bob',
      phone: '0769876543',
      positionId: posB.id,
      sourceId: srcB.id,
    });
    await h.phoneSelected(bob);
    const found = await get(`?search=${encodeURIComponent(bob.candidateCode)}`);
    assert.equal(found.body.total, 1);
    const stage = (
      await h.db.pool.query(
        `SELECT st.name FROM pipeline_status ps JOIN pipeline_stages st ON st.code = ps.current_stage
          WHERE ps.candidate_id = $1`,
        [bob.id],
      )
    ).rows[0].name;
    const latest = (
      await h.db.pool.query(
        `SELECT st.name FROM stage_history h JOIN pipeline_stages st ON st.code = h.to_stage
          WHERE h.candidate_id = $1 ORDER BY h.id DESC LIMIT 1`,
        [bob.id],
      )
    ).rows[0].name;
    assert.notEqual(stage, 'Applied');
    assert.equal(found.body.items[0].status, stage);
    assert.equal(latest, stage);
  });
});

describe('search, filters and paging over both kinds', () => {
  test('search finds history and candidates by name, Candidate ID, phone digits and remarks', async () => {
    assert.deepEqual(names(await get('?search=Alice')), ['Registration Sample Alice']);
    assert.deepEqual(names(await get('?search=Hist%20Sample%20Two')), ['Hist Sample Two']);
    assert.equal((await get(`?search=${encodeURIComponent(alice.candidateCode)}`)).body.total, 1);
    assert.equal((await get('?search=077-111')).body.total, 1);
    assert.equal((await get('?search=076-123')).body.total, 1);
    assert.equal((await get('?search=Second%20remark')).body.total, 1);
    assert.equal((await get('?search=nobody%20here')).body.total, 0);
    // LIKE wildcards typed by a user are plain characters, not "match everything".
    assert.equal((await get('?search=%25')).body.total, 0);
    assert.equal((await get('?search=_')).body.total, 0);
  });

  test('position, source and status filters work across history and candidates', async () => {
    // Position A: Hist One (history) and Alice (candidate).
    assert.deepEqual(names(await get('?position=Sample%20Position%20A')), [
      'Hist Sample One',
      'Registration Sample Alice',
    ]);
    assert.equal((await get('?position=sample%20position%20a')).body.total, 2, 'ignores case');
    assert.deepEqual(names(await get('?source=Sample%20Source%20B')), ['Registration Sample Bob']);
    assert.deepEqual(names(await get('?status=Selected')), ['Hist Sample One']);
    assert.deepEqual(names(await get('?status=Applied')), ['Registration Sample Alice']);
    // Blank cells in the history can be found.
    assert.deepEqual(names(await get('?position=__none')), ['Hist Sample Three']);
    assert.equal((await get('?position=Sample%20Position%20A&source=Referral')).body.total, 0);
  });

  test('pages through everything with candidates first', async () => {
    const all = await get('?pageSize=100');
    assert.equal(all.body.total, HISTORY + 2);
    const kinds = all.body.items.map((i) => i.kind);
    assert.deepEqual(kinds, ['candidate', 'candidate', 'historical', 'historical', 'historical']);

    const seen = new Set();
    for (const page of [1, 2, 3]) {
      const res = await get(`?pageSize=2&page=${page}`);
      for (const item of res.body.items) seen.add(`${item.kind}:${item.id}`);
    }
    assert.equal(seen.size, HISTORY + 2, 'every record appears exactly once across the pages');
    assert.equal((await get('?pageSize=2&page=4')).body.items.length, 0);
  });

  test('options come from the records themselves', async () => {
    const options = (await get('/options')).body;
    const has = (list, value) => list.some((o) => o.value === value);
    assert.ok(has(options.positions, 'Sample Position A'));
    assert.ok(has(options.positions, null), 'blank positions can be selected');
    assert.ok(has(options.sources, 'Sample Source B'));
    assert.ok(has(options.statuses, 'Selected'));
    assert.ok(has(options.statuses, 'Applied'));
  });
});

describe('who may use it', () => {
  test('Main User and HR can; Team Lead and Intern get 403; signed-out 401', async () => {
    for (const path of ['', '/options']) {
      assert.equal((await get(path)).status, 200);
      assert.equal((await get(path, { cookie: hr.cookie })).status, 200);
      assert.equal((await get(path, { cookie: teamLead.cookie })).status, 403);
      assert.equal((await get(path, { cookie: intern.cookie })).status, 403);
      assert.equal((await get(path, {})).status, 401);
    }
  });

  test('it is read only and exposes no salary, email or credential fields', async () => {
    const before = [
      await count('SELECT count(*)::int AS n FROM candidates'),
      await count('SELECT count(*)::int AS n FROM historical_interview_records'),
    ];
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const res = await get('', { ...h.asAdmin, method, body: { candidateName: 'x' } });
      assert.ok(res.status >= 400 && res.status < 500, `${method} ${res.status}`);
    }
    assert.deepEqual(
      [
        await count('SELECT count(*)::int AS n FROM candidates'),
        await count('SELECT count(*)::int AS n FROM historical_interview_records'),
      ],
      before,
    );
    const keys = Object.keys((await get()).body.items[0]).sort();
    assert.deepEqual(keys, [
      'candidateId',
      'candidateName',
      'contactNumber',
      'date',
      'extraValue',
      'id',
      'kind',
      'mode',
      'position',
      'recordNumber',
      'remarks',
      'reviewFlags',
      'source',
      'status',
    ]);
  });
});
