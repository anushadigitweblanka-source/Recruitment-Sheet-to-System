import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import ExcelJS from 'exceljs';
import { createApp } from '../src/app.js';
import { renderCsv } from '../src/modules/reports/reports.export.js';
import { createTestDatabase, createTestRole, createTestUser } from './helpers/testDb.js';

// Integration tests for the report exports. A real server and real tables in
// a throwaway schema; every name and value below is made up.

let db;
let server;
let baseUrl;
let admin;
let outsider;
let positionId;

async function raw(path, { cookie } = {}) {
  const res = await fetch(`${baseUrl}/api${path}`, {
    headers: cookie ? { Cookie: cookie } : {},
  });
  return {
    status: res.status,
    contentType: res.headers.get('content-type'),
    disposition: res.headers.get('content-disposition'),
    buffer: Buffer.from(await res.arrayBuffer()),
  };
}

async function signedIn(options) {
  const user = await createTestUser(db.pool, options);
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: user.email, password: user.password }),
  });
  return { ...user, cookie: res.headers.get('set-cookie').split(';')[0] };
}

async function candidateAt(code, stage, { fullName, createdAt } = {}) {
  const { rows } = await db.pool.query(
    `INSERT INTO candidates (candidate_code, full_name, phone, position_id, created_at)
     VALUES ($1, $2, $3, $4, coalesce($5::timestamptz, now())) RETURNING id`,
    [
      code,
      fullName ?? `Export Sample ${code}`,
      `07900${code.slice(-5).replace(/\D/g, '').padStart(5, '0')}`,
      positionId,
      createdAt ?? null,
    ],
  );
  const id = Number(rows[0].id);
  await db.pool.query(
    `INSERT INTO pipeline_status (candidate_id, current_stage, reject_reason)
     VALUES ($1, $2, $3)`,
    [id, stage, stage === 'rejected' ? 'fictional rejection' : null],
  );
  return id;
}

async function parseXlsx(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.worksheets[0];
  const rows = [];
  sheet.eachRow((row) => rows.push(row.values.slice(1)));
  return rows;
}

before(async () => {
  db = await createTestDatabase();
  server = createApp({ config: db.config, pool: db.pool }).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  await createTestRole(db.pool, 'outsider', []);
  admin = await signedIn();
  outsider = await signedIn({ roleCode: 'outsider' });

  const pos = await db.pool.query(
    `INSERT INTO positions (name) VALUES ('Export Position') RETURNING id`,
  );
  positionId = Number(pos.rows[0].id);

  await candidateAt('EXP-0001', 'applied', { createdAt: '2026-07-06T10:00:00+05:30' });
  await candidateAt('EXP-0002', 'rejected', {
    // A name with a comma, a quote and a newline, for the CSV escaping test.
    fullName: 'Export "Tricky", Sample\nSecond Line',
    createdAt: '2026-07-07T10:00:00+05:30',
  });
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await db.cleanup();
});

describe('access', () => {
  test('export refuses a visitor who is not signed in', async () => {
    assert.equal((await raw('/reports/candidate-status/export?format=xlsx')).status, 401);
  });

  test('export refuses a user without candidates.view', async () => {
    assert.equal(
      (await raw('/reports/candidate-status/export?format=csv', { cookie: outsider.cookie }))
        .status,
      403,
    );
  });

  test('an unknown report or format is refused', async () => {
    assert.equal(
      (await raw('/reports/nonsense/export?format=xlsx', { cookie: admin.cookie })).status,
      404,
    );
    assert.equal(
      (await raw('/reports/funnel/export?format=exe', { cookie: admin.cookie })).status,
      404,
    );
  });
});

describe('formats', () => {
  test('xlsx: correct content type, filename and a parseable workbook', async () => {
    const res = await raw('/reports/candidate-status/export?format=xlsx', {
      cookie: admin.cookie,
    });
    assert.equal(res.status, 200);
    assert.match(res.contentType, /spreadsheetml/);
    assert.match(
      res.disposition,
      /attachment; filename="candidate-status-\d{4}-\d{2}-\d{2}\.xlsx"/,
    );

    const rows = await parseXlsx(res.buffer);
    assert.equal(rows[0][0], 'Candidate Status Report');
    const header = rows.find((row) => row[0] === 'Candidate ID');
    assert.deepEqual(header.slice(0, 4), ['Candidate ID', 'Name', 'Position', 'Source']);
    assert.ok(
      rows.some((row) => row[0] === 'EXP-0001'),
      'data row present',
    );
  });

  test('csv: UTF-8 with correct escaping of commas, quotes and newlines', async () => {
    const res = await raw('/reports/candidate-status/export?format=csv', {
      cookie: admin.cookie,
    });
    assert.equal(res.status, 200);
    assert.match(res.contentType, /text\/csv/);
    assert.match(res.disposition, /filename="candidate-status-\d{4}-\d{2}-\d{2}\.csv"/);
    const text = res.buffer.toString('utf8');
    assert.ok(text.startsWith('﻿'), 'BOM present');
    assert.ok(
      text.includes('"Export ""Tricky"", Sample\nSecond Line"'),
      'quotes doubled, field quoted',
    );
  });

  test('csv renderer escapes exactly', () => {
    const text = renderCsv({
      columns: [{ key: 'a', label: 'A' }],
      rows: [{ a: 'plain' }, { a: 'has,comma' }, { a: 'has "quote"' }],
    });
    assert.ok(text.includes('plain\r\n'));
    assert.ok(text.includes('"has,comma"'));
    assert.ok(text.includes('"has ""quote"""'));
  });

  test('pdf: correct content type and a real PDF document', async () => {
    const res = await raw('/reports/candidate-status/export?format=pdf', {
      cookie: admin.cookie,
    });
    assert.equal(res.status, 200);
    assert.match(res.contentType, /application\/pdf/);
    assert.match(res.disposition, /filename="candidate-status-\d{4}-\d{2}-\d{2}\.pdf"/);
    assert.equal(res.buffer.subarray(0, 5).toString(), '%PDF-');
    assert.ok(res.buffer.length > 1000, 'non-empty document');
  });
});

describe('dataset correctness', () => {
  test('filters apply to the export exactly as to the screen', async () => {
    const res = await raw('/reports/candidate-status/export?format=csv&stage=rejected', {
      cookie: admin.cookie,
    });
    const text = res.buffer.toString('utf8');
    assert.ok(text.includes('EXP-0002'), 'filtered row present');
    assert.ok(!text.includes('EXP-0001'), 'row outside the filter absent');
  });

  test('an empty filtered export is still a valid file with headers', async () => {
    const res = await raw('/reports/candidate-status/export?format=xlsx&stage=joined', {
      cookie: admin.cookie,
    });
    const rows = await parseXlsx(res.buffer);
    assert.ok(
      rows.some((row) => row[0] === 'Candidate ID'),
      'headers present',
    );
    assert.ok(!rows.some((row) => row[0] === 'EXP-0001'), 'no data rows');
  });

  test('weekly export respects the chosen week', async () => {
    const res = await raw('/reports/weekly/export?format=csv&weekStart=2026-07-06', {
      cookie: admin.cookie,
    });
    const text = res.buffer.toString('utf8');
    const applications = text.split('\r\n').find((line) => line.includes('Applications'));
    assert.match(applications, /,2$/, 'both fixtures were added in that week');
  });

  test('every report exports in every format', async () => {
    for (const report of [
      'candidate-status',
      'funnel',
      'sources',
      'positions',
      'weekly',
      'onboarding',
      'exit',
    ]) {
      for (const format of ['xlsx', 'csv', 'pdf']) {
        const res = await raw(`/reports/${report}/export?format=${format}`, {
          cookie: admin.cookie,
        });
        assert.equal(res.status, 200, `${report} ${format}`);
        assert.ok(res.buffer.length > 0, `${report} ${format} not empty`);
      }
    }
  });

  test('no export contains salary or credential words', async () => {
    for (const format of ['csv']) {
      for (const report of ['candidate-status', 'sources', 'exit']) {
        const res = await raw(`/reports/${report}/export?format=${format}`, {
          cookie: admin.cookie,
        });
        const text = res.buffer.toString('utf8').toLowerCase();
        for (const word of ['salary', 'password', 'hash', 'token', 'credential']) {
          assert.ok(!text.includes(word), `${report} must not contain "${word}"`);
        }
      }
    }
  });
});
