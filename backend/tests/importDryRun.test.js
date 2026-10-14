// Tests for the import dry-run framework. Everything runs against a
// throwaway test schema with fictional data only; the dry run must leave
// every business table exactly as it found it.

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { runDryRun } from '../src/import/dryRun.js';
import { DryRunWriteError, readOnlyDb } from '../src/import/readOnlyDb.js';
import {
  isBlank,
  normalizeBoolean,
  normalizeCandidateId,
  normalizeDate,
  normalizeDateTime,
  normalizeEmail,
  normalizePhone,
  normalizeScore,
  resolveLookup,
} from '../src/import/normalize.js';
import { detectArea, mapHeaders } from '../src/import/expectedStructure.js';
import { matchCandidate } from '../src/import/matchCandidates.js';
import { readWorkbook } from '../src/import/workbook.js';
import { renderReport } from '../src/import/report.js';
import { buildFictionalWorkbook, FAKE } from './helpers/fictionalWorkbook.js';
import { createTestDatabase } from './helpers/testDb.js';

let db;
let workbookPath;

const BUSINESS_TABLES = [
  'candidates',
  'phone_screens',
  'interviews',
  'offers',
  'employees',
  'notifications',
  'email_log',
];

async function rowCounts(pool) {
  const counts = {};
  for (const table of BUSINESS_TABLES) {
    const { rows } = await pool.query(`SELECT count(*)::int AS n FROM ${table}`);
    counts[table] = rows[0].n;
  }
  return counts;
}

before(async () => {
  db = await createTestDatabase();
  // Fictional lookups and one fictional existing candidate, so matching and
  // duplicate detection have something to find.
  for (const name of FAKE.positions) {
    await db.pool.query('INSERT INTO positions (name) VALUES ($1)', [name]);
  }
  for (const name of FAKE.sources) {
    await db.pool.query('INSERT INTO sources (name) VALUES ($1)', [name]);
  }
  await db.pool.query(
    `INSERT INTO candidates (candidate_code, full_name, phone, email, position_id)
     VALUES ('FAKE-EXISTING', 'Existing Example', '0779999999', 'existing@example.test',
             (SELECT id FROM positions WHERE name = $1))`,
    [FAKE.positions[0]],
  );
  workbookPath = await buildFictionalWorkbook();
});

after(async () => {
  await db.cleanup();
});

describe('read-only guard', () => {
  test('allows SELECT and refuses every write', async () => {
    const guarded = readOnlyDb(db.pool);
    const { rows } = await guarded.query('SELECT 1 AS one');
    assert.equal(rows[0].one, 1);

    for (const sql of [
      "INSERT INTO candidates (candidate_code, full_name) VALUES ('X', 'X')",
      "UPDATE candidates SET full_name = 'X'",
      'DELETE FROM candidates',
      'TRUNCATE candidates',
      'SELECT 1; DELETE FROM candidates',
      'WITH x AS (DELETE FROM candidates RETURNING id) SELECT * FROM x',
    ]) {
      await assert.rejects(guarded.query(sql), DryRunWriteError);
    }
  });
});

describe('normalization', () => {
  test('phone stays text and numbers go to review', () => {
    assert.equal(normalizePhone(' 077 000-0001 ').value, '0770000001');
    assert.equal(normalizePhone('+94 77 000 0001').value, '+94770000001');
    assert.equal(normalizePhone(771234500).issue.code, 'invalid_phone');
    assert.equal(normalizePhone('12').issue.code, 'invalid_phone');
    assert.equal(normalizePhone('').value, null);
  });

  test('email is lowercased and shape-checked', () => {
    assert.equal(normalizeEmail(' A@Example.TEST ').value, 'a@example.test');
    assert.equal(normalizeEmail('not-an-email').issue.code, 'invalid_email');
  });

  test('dates: ISO and Date cells pass, ambiguous text goes to review', () => {
    assert.equal(normalizeDate('2026-11-10').value, '2026-11-10');
    assert.equal(normalizeDate(new Date(2026, 10, 10)).value, '2026-11-10');
    assert.equal(normalizeDate('03/04/2026').issue.code, 'invalid_date');
    assert.equal(normalizeDate('2026-02-31').issue.code, 'invalid_date');
    assert.equal(normalizeDate('soon').issue.code, 'invalid_date');
  });

  test('datetimes require an explicit timezone when given as text', () => {
    assert.ok(normalizeDateTime('2026-11-02T10:00:00+05:30').value);
    assert.equal(normalizeDateTime('2026-11-02 10:00').issue.code, 'invalid_date');
  });

  test('scores are whole numbers 0-10', () => {
    assert.equal(normalizeScore(10).value, 10);
    assert.equal(normalizeScore('7').value, 7);
    assert.equal(normalizeScore(11).issue.code, 'invalid_score');
    assert.equal(normalizeScore(2.5).issue.code, 'invalid_score');
  });

  test('candidate IDs are preserved as text and never invented', () => {
    assert.equal(normalizeCandidateId(' FAKE-01 ').value, 'FAKE-01');
    assert.equal(normalizeCandidateId('').issue.code, 'missing_required_field');
    assert.equal(normalizeCandidateId(1234).value, '1234');
  });

  test('lookups resolve only through an approved map', () => {
    assert.equal(
      resolveLookup('Selected', { selected: 'selected' }, 'unknown_status').value,
      'selected',
    );
    assert.equal(
      resolveLookup('Maybe', { selected: 'selected' }, 'unknown_status').issue.code,
      'unknown_status',
    );
    assert.equal(resolveLookup('Maybe', {}, 'unknown_status').issue.code, 'unknown_status');
    assert.equal(isBlank('  '), true);
  });

  test('booleans accept only unmistakable words', () => {
    assert.equal(normalizeBoolean('Yes').value, true);
    assert.equal(normalizeBoolean('no').value, false);
    assert.equal(normalizeBoolean('perhaps').issue.code, 'unknown_status');
  });
});

describe('workbook parsing and structure', () => {
  test('reads sheet names, headers and rows with real row numbers', async () => {
    const sheets = await readWorkbook(workbookPath);
    const names = sheets.map((s) => s.name);
    assert.deepEqual(names, [
      'Candidates',
      'Phone Screening',
      'Direct Interviews',
      'Offers',
      'Employees',
      'Random Notes',
    ]);
    const candidates = sheets[0];
    assert.equal(candidates.headers[0], 'Candidate ID');
    assert.equal(candidates.rows[0].rowNumber, 2);
    assert.equal(candidates.rows.length, 4);
  });

  test('detects areas by headers, not sheet names, and flags unknown sheets', async () => {
    const sheets = await readWorkbook(workbookPath);
    assert.equal(detectArea(sheets[0].headers).area.key, 'candidates');
    assert.equal(detectArea(sheets[1].headers).area.key, 'phone_screens');
    assert.equal(detectArea(sheets[2].headers).area.key, 'interviews');
    assert.equal(detectArea(sheets[3].headers).area.key, 'offers');
    assert.equal(detectArea(sheets[4].headers).area.key, 'employees');
    assert.equal(detectArea(sheets[5].headers), null);
  });

  test('maps headers and reports unknown and missing-required ones', async () => {
    const sheets = await readWorkbook(workbookPath);
    const detected = detectArea(sheets[0].headers);
    const { fieldToHeader, unknownHeaders, missingRequired } = mapHeaders(
      detected.area,
      sheets[0].headers,
    );
    assert.equal(fieldToHeader.candidateId, 'Candidate ID');
    assert.deepEqual(unknownHeaders, []);
    assert.deepEqual(missingRequired, []);
  });

  test('duplicate and blank headers are reported', async () => {
    const path = await buildFictionalWorkbook({
      sheets: [
        {
          name: 'Candidates',
          headers: ['Candidate ID', 'Name', 'Name', '', 'Applied Position'],
          rows: [['FAKE-H1', 'Header Example', 'x', 'y', 'Dummy Web Developer']],
        },
      ],
    });
    const sheets = await readWorkbook(path);
    const codes = sheets[0].headerIssues.map((i) => i.code);
    assert.deepEqual(codes, ['unknown_header', 'unknown_header']);
  });
});

describe('candidate matching (read-only)', () => {
  test('matches by candidate ID, phone, then email; none is a miss', async () => {
    const guarded = readOnlyDb(db.pool);
    const byId = await matchCandidate(guarded, { candidateId: 'FAKE-EXISTING' });
    assert.equal(byId.by, 'candidate_id');

    const byPhone = await matchCandidate(guarded, { phone: '+94779999999' });
    assert.equal(byPhone.by, 'phone');
    assert.equal(byPhone.matched.code, 'FAKE-EXISTING');

    const byEmail = await matchCandidate(guarded, { email: 'Existing@example.test' });
    assert.equal(byEmail.by, 'email');

    const miss = await matchCandidate(guarded, { candidateId: 'FAKE-NOBODY' });
    assert.equal(miss.matched, null);
  });
});

describe('full dry run', () => {
  let before_;
  let result;

  test('runs end to end and changes no business table', async () => {
    before_ = await rowCounts(db.pool);
    result = await runDryRun(db.pool, workbookPath);
    const after_ = await rowCounts(db.pool);
    assert.deepEqual(after_, before_, 'row counts must be identical before and after a dry run');
    assert.equal(result.mode, 'dry-run');
  });

  test('summarizes rows per sheet with statuses', () => {
    assert.equal(result.totals.scanned, 12);
    assert.ok(result.totals.review >= 9, `expected most rows to need review`);
    const bySheet = Object.fromEntries(result.sheets.map((s) => [s.name, s]));
    assert.equal(bySheet['Candidates'].rowsScanned, 4);
    assert.equal(bySheet['Random Notes'].area, null);
  });

  test('flags the expected issue codes', () => {
    const codes = result.issueCounts;
    assert.ok(codes.duplicate_candidate_id >= 1, 'in-file duplicate candidate ID');
    assert.ok(codes.reused_cv_link >= 1, 'reused CV link');
    assert.ok(codes.invalid_phone >= 1, 'numeric phone cell');
    assert.ok(codes.invalid_email >= 1, 'bad email');
    assert.ok(codes.invalid_date >= 1, 'ambiguous date');
    assert.ok(codes.invalid_score >= 2, 'out-of-range score, partial scores and total mismatch');
    assert.ok(codes.unknown_position >= 1, 'unknown position');
    assert.ok(codes.unknown_source >= 1, 'unknown source');
    assert.ok(codes.unknown_status >= 1, 'status words with no approved mapping');
    assert.ok(codes.unknown_sheet >= 1, 'unrecognized sheet');
    assert.ok(codes.missing_required_field >= 1, 'missing candidate ID');
    assert.ok(codes.unmatched_phone_interview >= 1, 'phone screen row matching nobody');
  });

  test('a clean row against approved mappings is READY', async () => {
    const path = await buildFictionalWorkbook({
      sheets: [
        {
          name: 'Candidates',
          headers: ['Candidate ID', 'Name', 'Phone', 'Email', 'Applied Position', 'Source'],
          rows: [
            [
              'FAKE-CLEAN-1',
              'Cleanly Example',
              '0770000010',
              'clean@example.test',
              FAKE.positions[0],
              FAKE.sources[0],
            ],
          ],
        },
      ],
    });
    const clean = await runDryRun(db.pool, path);
    assert.equal(clean.totals.ready, 1);
    assert.equal(clean.totals.review, 0);
  });

  test('existing candidates are reported as duplicates, never touched', async () => {
    const path = await buildFictionalWorkbook({
      sheets: [
        {
          name: 'Candidates',
          headers: ['Candidate ID', 'Name', 'Phone', 'Email', 'Applied Position'],
          rows: [
            [
              'FAKE-EXISTING',
              'Existing Example',
              '0779999999',
              'existing@example.test',
              FAKE.positions[0],
            ],
          ],
        },
      ],
    });
    const countsBefore = await rowCounts(db.pool);
    const dup = await runDryRun(db.pool, path);
    assert.deepEqual(await rowCounts(db.pool), countsBefore);
    assert.ok(dup.issueCounts.duplicate_candidate_id >= 1);
    assert.ok(dup.issueCounts.duplicate_candidate >= 1);
    const { rows } = await db.pool.query(
      `SELECT full_name FROM candidates WHERE candidate_code = 'FAKE-EXISTING'`,
    );
    assert.equal(rows[0].full_name, 'Existing Example');
  });

  test('salary-looking headers are flagged and never mapped', async () => {
    const path = await buildFictionalWorkbook({
      sheets: [
        {
          name: 'Offers',
          headers: ['Candidate ID', 'Position', 'Offer Date', 'Salary'],
          rows: [['FAKE-EXISTING', FAKE.positions[0], '2026-11-10', 99999]],
        },
      ],
    });
    const run = await runDryRun(db.pool, path);
    assert.ok(run.issueCounts.salary_column_present >= 1);
    const offers = run.sheets[0];
    assert.ok(offers.unknownHeaders.includes('Salary'), 'salary is not a mapped field');
  });

  test('the report is PII-safe: no phone, email or name values appear', () => {
    const report = renderReport(result);
    assert.ok(!report.includes('0770000001'), 'no phone value');
    assert.ok(!report.includes('example.test'), 'no email value');
    assert.ok(!report.includes('Testy'), 'no name value');
    assert.ok(report.includes('FAKE-0001'), 'candidate ID is the safe reference');
    assert.ok(report.includes('dry-run'));
  });
});
