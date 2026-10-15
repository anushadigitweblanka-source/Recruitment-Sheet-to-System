import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { decodeCsv, parseCsv, readCsvSheet } from '../src/import/csv.js';
import { runDryRun } from '../src/import/dryRun.js';
import { detectArea } from '../src/import/expectedStructure.js';
import { createTestDatabase } from './helpers/testDb.js';

// CSV support for the import dry-run, with a fictional file shaped like the
// real recruitment CSV: Windows-1252, CRLF, a quoted multi-line cell, blank
// lines and empty unnamed columns. No real value appears anywhere. The dry run
// must write nothing.

let db;
let dir;
let csvPath;

const CRLF = '\r\n';
const HEADER = 'Name,Contact #,Date,Source,Position,Mode,Status,Remarks,,,';

// Windows-1252: "é" is the single byte 0xE9, which is invalid UTF-8.
const fixture = [
  HEADER,
  'Csv Sample One,771234567,04/11/2026 14:30,Fictional Job Board,Dummy Automation Tester,Onsite,Selected,First note,,,',
  'Café Sample,0770000002,05/11/2026 10:00,Fictional Job Board,Dummy Web Developer,Online,Rejected,"Line one' +
    CRLF +
    'line two, with a comma",,,',
  ',,,,,,,,,,',
  'Csv Sample One,771234567,04/11/2026 14:30,Fictional Job Board,Dummy Automation Tester,Onsite,Selected,Again,,,',
  'Existing Example,0779999999,2026-11-06T09:00:00+05:30,Unknown Board,Mystery Position,Online,Selected,,,,',
  'Csv Sample Three,,,,,,,,,,',
].join(CRLF);

const BUSINESS_TABLES = ['candidates', 'phone_screens', 'interviews', 'offers', 'employees'];
async function rowCounts(pool) {
  const counts = {};
  for (const table of BUSINESS_TABLES) {
    counts[table] = (await pool.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n;
  }
  return counts;
}

before(async () => {
  db = await createTestDatabase();
  for (const name of ['Dummy Automation Tester', 'Dummy Web Developer']) {
    await db.pool.query('INSERT INTO positions (name) VALUES ($1)', [name]);
  }
  await db.pool.query('INSERT INTO sources (name) VALUES ($1)', ['Fictional Job Board']);
  await db.pool.query(
    `INSERT INTO candidates (candidate_code, full_name, phone, email, position_id)
     VALUES ('FAKE-EXISTING', 'Existing Example', '0779999999', 'existing@example.test',
             (SELECT id FROM positions WHERE name = 'Dummy Automation Tester'))`,
  );
  dir = await mkdtemp(join(tmpdir(), 'csv-fixture-'));
  csvPath = join(dir, 'fictional-interview-schedules.csv');
  await writeFile(csvPath, Buffer.from(fixture, 'latin1')); // latin1 bytes = Windows-1252 here
});

after(async () => {
  await rm(dir, { recursive: true, force: true });
  await db.cleanup();
});

describe('CSV decoding and parsing', () => {
  test('reads valid UTF-8 as UTF-8, dropping a byte order mark', () => {
    const bytes = Buffer.from('﻿Name\r\nZoë\r\n', 'utf8');
    const { text, encoding } = decodeCsv(bytes);
    assert.equal(encoding, 'utf-8');
    assert.equal(text, 'Name\r\nZoë\r\n');
  });

  test('falls back to Windows-1252 for bytes that are not UTF-8', () => {
    const { text, encoding } = decodeCsv(Buffer.from([0x43, 0x61, 0x66, 0xe9]));
    assert.equal(encoding, 'windows-1252');
    assert.equal(text, 'Café');
  });

  test('keeps quoted line breaks, commas and doubled quotes inside one cell', () => {
    const records = parseCsv('a,b\r\n"x\r\ny, ""z""",2\r\n');
    assert.deepEqual(records, [
      ['a', 'b'],
      ['x\r\ny, "z"', '2'],
    ]);
  });

  test('handles LF and CR line endings and a missing final line break', () => {
    assert.deepEqual(parseCsv('a,b\n1,2'), [
      ['a', 'b'],
      ['1', '2'],
    ]);
    assert.deepEqual(parseCsv('a\r1\r'), [['a'], ['1']]);
  });
});

describe('reading the CSV as a sheet', () => {
  test('numbers records, drops blank rows and empty unnamed columns, names nothing it invented', async () => {
    const sheet = await readCsvSheet(csvPath);
    assert.equal(sheet.meta.encoding, 'windows-1252');
    assert.deepEqual(sheet.headers, [
      'Name',
      'Contact #',
      'Date',
      'Source',
      'Position',
      'Mode',
      'Status',
      'Remarks',
    ]);
    assert.equal(sheet.meta.emptyColumns, 3);
    assert.equal(sheet.rows.length, 5, 'the blank record is dropped');
    // Record numbers count the header as 1 and the multi-line cell as one record.
    assert.deepEqual(
      sheet.rows.map((r) => r.rowNumber),
      [2, 3, 5, 6, 7],
    );
    const cafe = sheet.rows[1].values;
    assert.equal(cafe.Name, 'Café Sample');
    assert.equal(cafe.Remarks, 'Line one\r\nline two, with a comma');
    assert.equal(sheet.rows[4].values['Contact #'], null);
  });

  test('is recognized as the interview schedules tab, not the candidate master', async () => {
    const sheet = await readCsvSheet(csvPath);
    const detected = detectArea(sheet.headers);
    assert.equal(detected.area.key, 'interview_schedules');
  });
});

describe('dry run of the CSV', () => {
  test('classifies every row, reports the gaps and writes nothing', async () => {
    const before = await rowCounts(db.pool);
    const result = await runDryRun(db.pool, csvPath);
    const after = await rowCounts(db.pool);
    assert.deepEqual(after, before, 'no business table changed');

    const [sheet] = result.sheets;
    assert.equal(sheet.area, 'interview_schedules');
    assert.equal(sheet.rowsScanned, 5);

    const issuesAt = (row) => sheet.rows.find((r) => r.rowNumber === row).issues.map((i) => i.code);

    // Row 2: lost leading zero, day-first text date, unapproved status word.
    assert.ok(issuesAt(2).includes('invalid_phone'));
    assert.ok(issuesAt(2).includes('invalid_date'));
    assert.ok(issuesAt(2).includes('unknown_status'));
    assert.ok(issuesAt(2).includes('unmatched_schedule_row'));
    // Row 3: has a leading zero, so the phone is accepted; the date is still unconfirmed.
    assert.ok(!issuesAt(3).includes('invalid_phone'));
    // Row 5 repeats row 2's person and time.
    assert.ok(issuesAt(5).includes('duplicate_schedule_row'));
    // Row 6 matches the existing candidate by phone; unknown lookups are flagged.
    const matched = sheet.rows.find((r) => r.rowNumber === 6);
    assert.equal(matched.safeRef, 'FAKE-EXISTING');
    assert.ok(issuesAt(6).includes('unknown_position'));
    assert.ok(issuesAt(6).includes('unknown_source'));
    assert.ok(!issuesAt(6).includes('unmatched_schedule_row'));
    // The Mode column has nowhere to go and is reported once for the sheet.
    assert.ok(sheet.structureIssues.some((i) => i.code === 'no_destination_column'));
    // Nothing is READY while no mapping has been approved.
    assert.equal(result.totals.ready, 0);
  });

  test('never carries a name, phone or remark into its issue text', async () => {
    const result = await runDryRun(db.pool, csvPath);
    const text = JSON.stringify(result.sheets);
    for (const secret of [
      'Csv Sample',
      'Café',
      '771234567',
      '0770000002',
      'line two',
      'First note',
    ]) {
      assert.ok(!text.includes(secret), `${secret} must not appear in the result`);
    }
  });
});
