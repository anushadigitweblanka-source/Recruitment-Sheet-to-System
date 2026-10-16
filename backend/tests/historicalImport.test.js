import assert from 'node:assert/strict';
import { mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import {
  GUARDED_TABLES,
  dryRun,
  executeImport,
  rollbackBatch,
  tableCounts,
  verifyBackup,
} from '../src/modules/historical/importer.js';
import { interviewOn } from '../src/modules/historical/review.js';
import { runNotificationScheduler } from '../src/modules/notifications/notifications.service.js';
import { startHarness } from './helpers/harness.js';

// The historical interview log: importer, rollback and the read-only API.
// Everything is fictional: invented names, 07xx numbers and an .example.test
// style of content. The tables come from migration 015, which the harness applies to its own
// throwaway schema like every other migration.

const CRLF = '\r\n';
const HEADER = 'Date,Source,Name,Contact #,Mode,Position,Status,Remarks,,';
// Windows-1252: "é" is the single byte 0xE9.
const LINES = [
  HEADER,
  '04/11/2026 14:30,Fictional Board,Hist Sample One,0771111111,Onsite,Sample Position A,Selected,First remark,,extra one',
  '05/11/2026,Fictional Board,Café Sample,771222222,Online,Sample Position B,Rejected,"Two lines' +
    CRLF +
    'and, a comma",,',
  ',Referral,Hist Sample Three,0773333333,Onsite,Sample Position A,,,,',
  '18/06/2026,,Hist Sample Four,0774444444,,,Not Attended,,,',
  '07.11.2026,Fictional Board,Hist Sample Five,0775555555,Online,Sample Position A,On Hold,note,,',
  '06/11/2026,Fictional Board,Hist Sample Six,0776666666,Onsite,Sample Position A,Selected,,,',
  '09/11/2026,Fictional Board,Hist Sample Six Different,0776666666,Onsite,Sample Position A,Selected,,,',
  '10/11/2026,Fictional Board,,12,Onsite,Sample Position A,Selected,,,',
  '03/04/2031,Fictional Board,Hist Sample Nine,0779999999,Online,Sample Position A,Rescheduled,,,',
];
const RECORDS = LINES.length - 1;

const ALL_TABLES = GUARDED_TABLES;

let h;
let dir;
let csv;
let hr;
let teamLead;
let intern;

const get = (path, who = h.asAdmin) => h.api(`/historical-interviews${path}`, who);

before(async () => {
  h = await startHarness();
  hr = await h.signedIn({ roleCode: 'hr' });
  teamLead = await h.signedIn({ roleCode: 'team_lead' });
  intern = await h.signedIn({ roleCode: 'intern_dev' });
  dir = await mkdtemp(join(tmpdir(), 'historical-fixture-'));
  csv = join(dir, 'fictional-interview-log.csv');
  await writeFile(csv, Buffer.from(LINES.join(CRLF), 'latin1'));
});

after(async () => {
  await rm(dir, { recursive: true, force: true });
  await h.stop();
});

describe('access control (migration 015 permission)', () => {
  const ROUTES = ['', '/summary', '/options', '?search=anything', '?pageSize=100&review=true'];

  test('historical.view is held by the Main User and HR only', async () => {
    const { rows } = await h.db.pool.query(
      `SELECT r.code FROM role_permissions rp
         JOIN roles r ON r.id = rp.role_id
         JOIN permissions p ON p.id = rp.permission_id
        WHERE p.code = 'historical.view' ORDER BY r.code`,
    );
    assert.deepEqual(
      rows.map((row) => row.code),
      ['hr', 'main_user'],
    );
  });

  test('Main User and HR can read every route', async () => {
    for (const path of ROUTES) {
      assert.equal((await get(path)).status, 200, `main user ${path}`);
      assert.equal((await get(path, { cookie: hr.cookie })).status, 200, `hr ${path}`);
    }
  });

  test('Team Lead and Intern get 403 and signed-out callers 401 on every route', async () => {
    for (const path of ROUTES) {
      assert.equal((await get(path, { cookie: teamLead.cookie })).status, 403, `team lead ${path}`);
      assert.equal((await get(path, { cookie: intern.cookie })).status, 403, `intern ${path}`);
      assert.equal((await get(path, {})).status, 401, `signed out ${path}`);
    }
  });

  test('no role can write through the API: every write method is rejected', async () => {
    const before = await h.db.pool.query(
      'SELECT (SELECT count(*) FROM historical_import_batches)::int AS b, (SELECT count(*) FROM historical_interview_records)::int AS r',
    );
    const callers = [
      { who: 'main user', opts: h.asAdmin },
      { who: 'hr', opts: { cookie: hr.cookie } },
      { who: 'team lead', opts: { cookie: teamLead.cookie } },
      { who: 'intern', opts: { cookie: intern.cookie } },
      { who: 'signed out', opts: {} },
    ];
    for (const { who, opts } of callers) {
      for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
        for (const path of ['', '/1', '/summary']) {
          const res = await get(path, { ...opts, method, body: { candidateName: 'x' } });
          assert.ok(
            res.status >= 400 && res.status < 500,
            `${who} ${method} ${path} answered ${res.status}`,
          );
        }
      }
    }
    const after = await h.db.pool.query(
      'SELECT (SELECT count(*) FROM historical_import_batches)::int AS b, (SELECT count(*) FROM historical_interview_records)::int AS r',
    );
    assert.deepEqual(after.rows[0], before.rows[0]);
  });
});

describe('dry run', () => {
  test('a dry run needs no database and prints counts only', async () => {
    const plan = await dryRun(csv);
    assert.equal(plan.records, RECORDS);
    assert.equal(plan.encoding, 'windows-1252');
    assert.equal(plan.fingerprint.length, 16);
    assert.equal(plan.clean + plan.needingReview, RECORDS);
    const text = JSON.stringify(plan);
    for (const value of ['Hist Sample', 'Café', '0771111111', 'First remark']) {
      assert.ok(!text.includes(value), `${value} must not be in the plan`);
    }
  });
});

describe('review rules', () => {
  test('flags are about attention, nothing is repaired or dropped', async () => {
    const plan = await dryRun(csv);
    assert.equal(plan.records, RECORDS);
    assert.deepEqual(plan.flagCounts, {
      phone_unusual: 2, // a nine-digit number and a two-digit value
      date_missing: 1,
      date_year_unexpected: 1, // 2031
      status_missing: 1,
      name_missing: 1,
      phone_shared_different_names: 2, // one phone under two names
    });
    assert.equal(plan.needingReview, 6);
    assert.equal(plan.clean, 3);
    // Nothing is dropped: every record is counted as clean or needing review.
    assert.equal(plan.clean + plan.needingReview, RECORDS);
  });

  test('only an unambiguous day-first date in 2025-2026 is converted', () => {
    assert.equal(interviewOn('18/06/2026'), '2026-06-18');
    assert.equal(interviewOn('04/11/2026 14:30'), '2026-11-04');
    assert.equal(interviewOn('7.11.2026'), '2026-11-07');
    assert.equal(interviewOn('31/02/2026'), null); // not a real day
    assert.equal(interviewOn('03/04/2031'), null); // year not expected
    assert.equal(interviewOn('not a date'), null);
    assert.equal(interviewOn(null), null);
  });
});

describe('with migration 015 applied', () => {
  test('a backup must exist, be non-empty and be recent', async () => {
    const empty = join(dir, 'empty.dump');
    await writeFile(empty, '');
    assert.throws(() => verifyBackup(join(dir, 'missing.dump')), /does not exist/);
    assert.throws(() => verifyBackup(empty), /empty/);

    const old = join(dir, 'old.dump');
    await writeFile(old, 'x');
    const longAgo = new Date(Date.now() - 3 * 24 * 3600 * 1000);
    await utimes(old, longAgo, longAgo);
    assert.throws(() => verifyBackup(old), /older than/);

    const fresh = join(dir, 'fresh.dump');
    await writeFile(fresh, 'x');
    assert.equal(verifyBackup(fresh).sizeBytes, 1);
  });

  test('refuses a wrong or missing fingerprint and writes nothing', async () => {
    const before = await tableCounts(h.db.pool);
    for (const confirmSha of [undefined, '', 'abc', '0'.repeat(16)]) {
      await assert.rejects(
        executeImport(h.db.pool, csv, { confirmSha }),
        (err) => err.code === 'fingerprint_mismatch',
      );
    }
    assert.deepEqual(await tableCounts(h.db.pool), before);
    const { rows } = await h.db.pool.query(
      'SELECT count(*)::int AS n FROM historical_import_batches',
    );
    assert.equal(rows[0].n, 0);
  });

  let batchId;
  test('imports every record once, preserves the originals and touches nothing else', async () => {
    const plan = await dryRun(csv);
    const before = await tableCounts(h.db.pool);

    const result = await executeImport(h.db.pool, csv, { confirmSha: plan.fingerprint });
    batchId = result.batchId;
    assert.equal(result.imported, RECORDS);
    assert.equal(result.needingReview, plan.needingReview);
    assert.deepEqual(await tableCounts(h.db.pool), before, 'no recruitment table changed');
    for (const table of ALL_TABLES)
      assert.equal((await tableCounts(h.db.pool))[table], before[table]);

    const { rows } = await h.db.pool.query(
      `SELECT * FROM historical_interview_records WHERE batch_id = $1 ORDER BY record_number`,
      [batchId],
    );
    assert.equal(rows.length, RECORDS);
    // The header is record 1; the multi-line cell is one record.
    assert.deepEqual(
      rows.map((r) => r.record_number),
      [2, 3, 4, 5, 6, 7, 8, 9, 10],
    );
    const one = rows[0];
    assert.equal(one.candidate_name, 'Hist Sample One');
    assert.equal(one.contact_number, '0771111111');
    assert.equal(one.original_status, 'Selected');
    assert.equal(one.interview_date_text, '04/11/2026 14:30');
    assert.equal(one.extra_value, 'extra one');
    const cafe = rows[1];
    assert.equal(cafe.candidate_name, 'Café Sample');
    assert.equal(cafe.contact_number, '771222222', 'the lost zero is NOT restored');
    assert.equal(cafe.remarks, 'Two lines\r\nand, a comma');
    assert.equal(rows[3].original_status, 'Not Attended', 'a status is never converted');
    assert.equal(rows[2].interview_date_text, null);
    assert.ok(rows[2].review_flags.includes('date_missing'));
  });

  test('loading the same file again is refused and changes nothing', async () => {
    const plan = await dryRun(csv);
    await assert.rejects(
      executeImport(h.db.pool, csv, { confirmSha: plan.fingerprint }),
      (err) => err.code === 'already_imported' && err.batchId === batchId,
    );
    const { rows } = await h.db.pool.query(
      'SELECT count(*)::int AS n FROM historical_interview_records',
    );
    assert.equal(rows[0].n, RECORDS);
  });

  test('no mail, reminder, offer, employee or stage change can come from it', async () => {
    const spy = { mode: 'spy', calls: [], send: async (m) => spy.calls.push(m) };
    await runNotificationScheduler(h.db.pool, spy, { config: h.config });
    assert.equal(spy.calls.length, 0);
    for (const table of ['notifications', 'email_log', 'offers', 'employees', 'phase_history']) {
      const { rows } = await h.db.pool.query(`SELECT count(*)::int AS n FROM ${table}`);
      assert.equal(rows[0].n, 0, table);
    }
    // The historical tables reference no recruitment table.
    const { rows } = await h.db.pool.query(
      `SELECT confrelid::regclass::text AS target
         FROM pg_constraint
        WHERE contype = 'f'
          AND conrelid IN ('historical_import_batches'::regclass,
                           'historical_interview_records'::regclass)`,
    );
    const targets = rows.map((r) => r.target.replace(/^.*\./, ''));
    assert.deepEqual(targets.sort(), ['historical_import_batches', 'users', 'users']);
  });

  describe('the read-only API', () => {
    test('Main User and HR can list; Team Lead, Intern and signed-out callers cannot', async () => {
      assert.equal((await get('')).status, 200);
      assert.equal((await get('', { cookie: hr.cookie })).status, 200);
      assert.equal((await get('', { cookie: teamLead.cookie })).status, 403);
      assert.equal((await get('', { cookie: intern.cookie })).status, 403);
      assert.equal((await get('', {})).status, 401);
      for (const path of ['/summary', '/options']) {
        assert.equal((await get(path, { cookie: teamLead.cookie })).status, 403);
      }
    });

    test('lists every field, newest first, with the original values', async () => {
      const res = await get('?pageSize=100');
      assert.equal(res.body.total, RECORDS);
      const first = res.body.items.find((i) => i.candidateName === 'Hist Sample One');
      assert.deepEqual(
        {
          date: first.interviewDateText,
          on: first.interviewOn,
          phone: first.contactNumber,
          source: first.source,
          mode: first.mode,
          position: first.position,
          status: first.originalStatus,
          remarks: first.remarks,
        },
        {
          date: '04/11/2026 14:30',
          on: '2026-11-04',
          phone: '0771111111',
          source: 'Fictional Board',
          mode: 'Onsite',
          position: 'Sample Position A',
          status: 'Selected',
          remarks: 'First remark',
        },
      );
      // Dated records first, undated last.
      const dates = res.body.items.map((i) => i.interviewOn);
      const lastDated = dates.map((d) => d !== null).lastIndexOf(true);
      assert.ok(dates.slice(0, lastDated + 1).every((d) => d !== null));
    });

    test('pages, searches and filters', async () => {
      const page = await get('?pageSize=4&page=3');
      assert.equal(page.body.items.length, 1);
      assert.equal(page.body.total, RECORDS);

      assert.equal((await get('?search=Hist%20Sample%20Four')).body.total, 1);
      assert.equal((await get('?search=0771111111')).body.total, 1);
      assert.equal((await get('?search=Two%20lines')).body.total, 1);
      assert.equal((await get('?status=Selected')).body.total, 4);
      assert.equal((await get('?status=__none')).body.total, 1);
      assert.equal((await get('?mode=Online')).body.total, 3);
      assert.equal((await get('?source=__none')).body.total, 1);
      assert.equal((await get('?position=Sample%20Position%20A')).body.total, 7);
      assert.equal((await get('?position=__none')).body.total, 1);
      assert.equal((await get('?position=Nothing%20like%20this')).body.total, 0);
      assert.equal((await get('?dateFrom=2026-11-05&dateTo=2026-11-07')).body.total, 3);
    });

    test('review filters show records needing attention without discarding any', async () => {
      const all = await get('?pageSize=100');
      const review = await get('?review=true&pageSize=100');
      const clean = all.body.items.filter((i) => i.reviewFlags.length === 0).length;
      assert.equal(review.body.total + clean, RECORDS);
      assert.ok(review.body.items.every((i) => i.reviewFlags.length > 0));

      const shared = await get('?flag=phone_shared_different_names');
      assert.equal(shared.body.total, 2);
      const unusual = await get('?flag=phone_unusual');
      assert.ok(unusual.body.total >= 2);
      // An unknown flag is ignored rather than breaking the query.
      assert.equal((await get('?flag=nonsense')).body.total, RECORDS);
    });

    test('summary and options come from the stored data', async () => {
      const summary = (await get('/summary')).body;
      assert.equal(summary.records, RECORDS);
      assert.equal(summary.batches.length, 1);
      assert.equal(summary.batches[0].importedCount, RECORDS);
      assert.ok(summary.needingReview > 0);

      const options = (await get('/options')).body;
      assert.ok(options.statuses.some((s) => s.value === 'Selected' && s.count === 4));
      assert.ok(options.modes.some((m) => m.value === 'Online'));
      assert.ok(options.positions.some((p) => p.value === 'Sample Position A' && p.count === 7));
      assert.ok(options.flags.some((f) => f.flag === 'date_missing'));
    });

    test('every view is audited without any name, number or search text', async () => {
      await get('?search=Hist%20Sample%20Four');
      const { rows } = await h.db.pool.query(
        `SELECT details FROM audit_log WHERE action = 'HISTORICAL_VIEW' ORDER BY id DESC LIMIT 1`,
      );
      const text = JSON.stringify(rows[0].details);
      assert.match(text, /"filtersUsed":\["search"\]/);
      assert.ok(!text.includes('Four'));
    });
  });

  test('rollback removes the batch, keeps its record, and the file can be loaded again', async () => {
    const before = await tableCounts(h.db.pool);
    const removed = await rollbackBatch(h.db.pool, batchId);
    assert.equal(removed.removed, RECORDS);
    assert.deepEqual(await tableCounts(h.db.pool), before);

    const { rows } = await h.db.pool.query(
      `SELECT status FROM historical_import_batches WHERE id = $1`,
      [batchId],
    );
    assert.equal(rows[0].status, 'rolled_back');
    assert.equal((await get('')).body.total, 0);
    await assert.rejects(
      rollbackBatch(h.db.pool, batchId),
      (e) => e.code === 'already_rolled_back',
    );
    await assert.rejects(rollbackBatch(h.db.pool, 999999), (e) => e.code === 'not_found');

    const plan = await dryRun(csv);
    const again = await executeImport(h.db.pool, csv, { confirmSha: plan.fingerprint });
    assert.equal(again.imported, RECORDS);
    assert.notEqual(again.batchId, batchId);
    assert.equal((await get('')).body.total, RECORDS);
  });

  test('a file that is not an interview log is refused', async () => {
    const other = join(dir, 'other.csv');
    await writeFile(other, 'Foo,Bar\r\n1,2\r\n');
    await assert.rejects(dryRun(other), (err) => err.code === 'not_interview_log');
  });
});

describe('historical records cannot change the live recruitment records', () => {
  const SNAPSHOT_TABLES = [
    'candidates',
    'pipeline_status',
    'stage_history',
    'phone_screens',
    'interviews',
    'offers',
    'employees',
    'phase_history',
    'notifications',
    'email_log',
  ];
  const snapshot = async () => {
    const out = {};
    for (const table of SNAPSHOT_TABLES) {
      const { rows } = await h.db.pool.query(
        `SELECT count(*)::int AS n,
                md5(coalesce(string_agg(t::text, ',' ORDER BY t::text), '')) AS hash
           FROM ${table} t`,
      );
      out[table] = rows[0];
    }
    return out;
  };

  test('reading, refused access and writes leave candidates, offers, employees and notifications untouched', async () => {
    const candidate = await h.newCandidate();
    const before = await snapshot();
    const recordsBefore = (await get('?pageSize=100')).body.total;
    assert.ok(recordsBefore > 0, 'historical records are present for this test');

    const callers = [
      h.asAdmin,
      { cookie: hr.cookie },
      { cookie: teamLead.cookie },
      { cookie: intern.cookie },
      {},
    ];
    for (const opts of callers) {
      for (const path of ['', '/summary', '/options', '?search=Hist']) await get(path, opts);
      for (const method of ['POST', 'PATCH', 'DELETE']) {
        await get('/1', { ...opts, method, body: { originalStatus: 'Selected' } });
      }
    }

    assert.deepEqual(await snapshot(), before);
    const { rows } = await h.db.pool.query('SELECT full_name FROM candidates WHERE id = $1', [
      candidate.id,
    ]);
    assert.equal(rows[0].full_name, candidate.fullName);
    assert.equal((await get('?pageSize=100')).body.total, recordsBefore);
  });
});
