// Tests for automatic Candidate IDs (DDMMYYYY + the day's order number).
// They run on a throwaway IN-MEMORY Postgres (PGlite) with the real
// migrations; recruitment_system_dev and every other database stay untouched.
// All people below are fictional.
//
// A note on concurrency: PGlite is one connection, so requests here take turns
// and these tests cannot show two real connections racing. They show that
// simultaneous requests all succeed with distinct, gap-free numbers, and the
// "stale allocation" test forces the exact clash a race would cause to prove
// the unique index plus retry still yields a unique ID.

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import {
  allocateCandidateId,
  candidateIdPrefix,
  formatCandidateId,
} from '../src/modules/candidates/candidateId.js';
import { createCandidate, editCandidate } from '../src/modules/candidates/candidates.service.js';
import { startMemoryHarness } from './helpers/memoryDb.js';

// 21 October 2026 at 10:30 in Colombo (UTC+05:30).
const OCT_21 = new Date('2026-10-21T05:00:00Z');
const OCT_22 = new Date('2026-10-22T05:00:00Z');

let h;
let user;
let counter = 0;

// A different fictional person each time, so duplicate rules never interfere.
const person = (overrides = {}) => {
  counter += 1;
  return {
    fullName: `Sample Person ${counter}`,
    phone: `07100${String(counter).padStart(5, '0')}`,
    email: `sample.${counter}@example.test`,
    ...overrides,
  };
};
const register = (input = person(), options = {}, pool = h.pool) =>
  createCandidate(pool, user, input, options);
const codes = async () =>
  (await h.query('SELECT candidate_code FROM candidates ORDER BY id')).map((r) => r.candidate_code);

before(async () => {
  h = await startMemoryHarness();
  user = await h.signedIn({ roleCode: 'hr' });
});
after(async () => {
  await h.stop();
});

describe('the ID format', () => {
  test('uses the Asia/Colombo date, with a day, month and four-digit year', () => {
    assert.equal(candidateIdPrefix(OCT_21), '21102026');
    assert.equal(formatCandidateId('21102026', 1), '2110202601');
    assert.equal(formatCandidateId('21102026', 12), '2110202612');
    assert.equal(formatCandidateId('21102026', 100), '21102026100');
  });

  test('near midnight the Colombo date decides, not UTC', () => {
    // 23:59:59 on 20 October in Colombo is still the 20th (18:29:59 UTC).
    assert.equal(candidateIdPrefix(new Date('2026-10-20T18:29:59Z')), '20102026');
    // One second later it is 00:00:00 on the 21st in Colombo.
    assert.equal(candidateIdPrefix(new Date('2026-10-20T18:30:00Z')), '21102026');
    // The year changes at Colombo midnight too.
    assert.equal(candidateIdPrefix(new Date('2026-12-31T18:29:59Z')), '31122026');
    assert.equal(candidateIdPrefix(new Date('2026-12-31T18:30:00Z')), '01012027');
    // Early morning in Colombo is still the previous day in UTC.
    assert.equal(candidateIdPrefix(new Date('2026-10-21T00:10:00Z')), '21102026');
  });
});

describe('the daily order number', () => {
  test('the first registration of the day gets 01, the next 02, then 03', async () => {
    for (const expected of ['2110202601', '2110202602', '2110202603']) {
      const result = await register(person(), { now: OCT_21 });
      assert.equal(result.ok, true, JSON.stringify(result));
      assert.equal(result.candidate.candidateCode, expected);
    }
  });

  test('a new day starts again from 01', async () => {
    const first = await register(person(), { now: OCT_22 });
    assert.equal(first.candidate.candidateCode, '2210202601');
    const second = await register(person(), { now: OCT_22 });
    assert.equal(second.candidate.candidateCode, '2210202602');
    // The earlier day carries on from where it was.
    const earlier = await register(person(), { now: OCT_21 });
    assert.equal(earlier.candidate.candidateCode, '2110202604');
  });

  test('a registration just after Colombo midnight belongs to the new day', async () => {
    const before = await register(person(), { now: new Date('2026-11-04T18:29:59Z') });
    const after = await register(person(), { now: new Date('2026-11-04T18:30:00Z') });
    assert.equal(before.candidate.candidateCode, '0411202601');
    assert.equal(after.candidate.candidateCode, '0511202601');
  });

  test('existing and legacy IDs are respected and never reused or changed', async () => {
    const insert = (code, name) =>
      h.query(`INSERT INTO candidates (candidate_code, full_name) VALUES ($1, $2)`, [code, name]);
    // A typed ID in today's pattern, plus legacy and unrelated codes.
    await insert('1511202605', 'Typed Example');
    await insert('2008', 'Legacy Example');
    await insert('f12345', 'Letters Example');
    await insert('15112026', 'Bare Date Example');
    await insert('151120261', 'One Digit Example');
    const before = await codes();

    const next = await register(person(), { now: new Date('2026-11-15T05:00:00Z') });
    assert.equal(next.candidate.candidateCode, '1511202606');

    // Every earlier ID is exactly as it was.
    const after = await codes();
    assert.deepEqual(after.slice(0, before.length), before);
  });

  test('after order 99 the number simply gets a third digit and stays unique', async () => {
    await h.query(
      `INSERT INTO candidates (candidate_code, full_name) VALUES ('2311202699', 'Day Full')`,
    );
    const a = await register(person(), { now: new Date('2026-11-23T05:00:00Z') });
    const b = await register(person(), { now: new Date('2026-11-23T05:00:00Z') });
    assert.equal(a.candidate.candidateCode, '23112026100');
    assert.equal(b.candidate.candidateCode, '23112026101');
  });
});

describe('safety', () => {
  test('simultaneous registrations all get different, consecutive numbers', async () => {
    const day = new Date('2027-01-10T05:00:00Z');
    const results = await Promise.all(
      Array.from({ length: 8 }, () => register(person(), { now: day })),
    );
    assert.ok(
      results.every((r) => r.ok),
      JSON.stringify(results.map((r) => r.reason)),
    );
    const made = results.map((r) => r.candidate.candidateCode).sort();
    assert.deepEqual(
      made,
      Array.from({ length: 8 }, (_, i) => `100120270${i + 1}`),
    );
  });

  test('two requests for the same person at once save only one candidate', async () => {
    const same = person();
    const day = new Date('2027-01-11T05:00:00Z');
    const results = await Promise.all([1, 2, 3].map(() => register({ ...same }, { now: day })));
    assert.equal(results.filter((r) => r.ok).length, 1);
    assert.ok(results.filter((r) => !r.ok).every((r) => r.reason === 'duplicate'));
    const rows = await h.query('SELECT 1 FROM candidates WHERE phone = $1', [same.phone]);
    assert.equal(rows.length, 1);
  });

  test('a registration that fails uses no number and leaves no gap', async () => {
    const day = new Date('2027-01-12T05:00:00Z');

    // 1. Invalid data.
    assert.equal((await register({ fullName: '' }, { now: day })).reason, 'validation');
    // 2. A duplicate warning, not confirmed.
    const first = await register(person(), { now: day });
    assert.equal(first.candidate.candidateCode, '1201202701');
    const repeat = await register({ ...first.candidate }, { now: day });
    assert.equal(repeat.reason, 'duplicate');
    // 3. A failure in the middle of saving (the audit write breaks).
    let breakOnce = true;
    const flaky = {
      query: (sql, params) => h.pool.query(sql, params),
      connect: async () => {
        const client = await h.pool.connect();
        return {
          query: (sql, params) => {
            if (breakOnce && /INSERT INTO audit_log/.test(sql)) {
              breakOnce = false;
              throw new Error('simulated failure while saving');
            }
            return client.query(sql, params);
          },
          release: () => client.release(),
        };
      },
    };
    await assert.rejects(register(person(), { now: day }, flaky), /simulated failure/);
    // Nothing from the failed attempts was saved...
    assert.equal(
      (await h.query(`SELECT 1 FROM candidates WHERE candidate_code LIKE '12012027%'`)).length,
      1,
    );
    // ...and the next success takes number 02, with no number skipped.
    const next = await register(person(), { now: day });
    assert.equal(next.candidate.candidateCode, '1201202702');
  });

  test('a stale allocation (a lost race) is caught by the unique index and retried', async () => {
    const day = new Date('2027-01-13T05:00:00Z');
    await register(person(), { now: day }); // 1301202701 now exists

    // Make the NEXT "highest number" lookup answer as if it ran before that
    // commit: it reports nothing, so 01 is chosen again and the index refuses.
    let staleOnce = true;
    const racing = {
      query: (sql, params) => h.pool.query(sql, params),
      connect: async () => {
        const client = await h.pool.connect();
        return {
          query: async (sql, params) => {
            if (staleOnce && /max\(substr\(candidate_code/.test(sql)) {
              staleOnce = false;
              return { rows: [{ highest: null }], rowCount: 1 };
            }
            return client.query(sql, params);
          },
          release: () => client.release(),
        };
      },
    };
    const result = await register(person(), { now: day }, racing);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.candidate.candidateCode, '1301202702');
    assert.equal(staleOnce, false, 'the stale answer was used');
    const rows = await h.query(
      `SELECT candidate_code FROM candidates WHERE candidate_code LIKE '13012027%'`,
    );
    assert.equal(rows.length, 2);
  });

  test('allocateCandidateId alone never saves anything', async () => {
    const before = await codes();
    const client = await h.pool.connect();
    try {
      await client.query('BEGIN');
      const code = await allocateCandidateId(client, new Date('2027-02-01T05:00:00Z'));
      assert.equal(code, '0102202701');
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
    assert.deepEqual(await codes(), before);
  });
});

describe('registration and editing through the API', () => {
  test('the ID comes from the server; one sent by the browser is ignored', async () => {
    const res = await h.api('/candidates', {
      method: 'POST',
      cookie: user.cookie,
      body: { ...person(), candidateCode: 'TYPED-BY-BROWSER' },
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.match(res.body.candidate.candidateCode, /^\d{10,}$/);
    assert.notEqual(res.body.candidate.candidateCode, 'TYPED-BY-BROWSER');
    assert.ok(
      res.body.candidate.candidateCode.startsWith(candidateIdPrefix()),
      'uses today in Colombo',
    );
  });

  test('registration works with no Candidate ID at all, and the audit trail records it', async () => {
    const res = await h.api('/candidates', { method: 'POST', cookie: user.cookie, body: person() });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const [audit] = await h.query(
      `SELECT new_values FROM audit_log WHERE entity_type = 'candidates' AND entity_id = $1`,
      [res.body.candidate.id],
    );
    assert.equal(audit.new_values.candidateCode, res.body.candidate.candidateCode);
  });

  test('the ID appears in the Candidate List and on the Candidate Details', async () => {
    const created = await h.api('/candidates', {
      method: 'POST',
      cookie: user.cookie,
      body: person(),
    });
    const { id, candidateCode } = created.body.candidate;

    const details = await h.api(`/candidates/${id}`, { cookie: user.cookie });
    assert.equal(details.body.candidate.candidateCode, candidateCode);
    const list = await h.api(`/candidates?search=${candidateCode}&pageSize=100`, {
      cookie: user.cookie,
    });
    assert.ok(list.body.items.some((c) => c.candidateCode === candidateCode));
    const unified = await h.api('/recruitment-records?pageSize=100', { cookie: user.cookie });
    assert.ok(unified.body.items.some((r) => r.candidateId === candidateCode));
  });

  test('editing a candidate never changes the Candidate ID', async () => {
    const created = await h.api('/candidates', {
      method: 'POST',
      cookie: user.cookie,
      body: person(),
    });
    const { id, candidateCode } = created.body.candidate;
    const edited = await h.api(`/candidates/${id}`, {
      method: 'PUT',
      cookie: user.cookie,
      body: { fullName: 'Renamed Sample', candidateCode: 'SOMETHING-ELSE' },
    });
    assert.equal(edited.status, 200, JSON.stringify(edited.body));
    assert.equal(edited.body.candidate.fullName, 'Renamed Sample');
    assert.equal(edited.body.candidate.candidateCode, candidateCode);
    const direct = await editCandidate(h.pool, user, id, { fullName: 'Renamed Again' });
    assert.equal(direct.candidate.candidateCode, candidateCode);
  });

  test('historical interview IDs and records are untouched', async () => {
    const [batch] = await h.query(
      `INSERT INTO historical_import_batches (file_name, file_sha256, encoding, record_count, status)
       VALUES ('fictional.csv', repeat('c', 64), 'utf-8', 1, 'completed') RETURNING id`,
    );
    await h.query(
      `INSERT INTO historical_interview_records
         (batch_id, record_number, row_hash, candidate_name, contact_number, position, original_status)
       VALUES ($1, 2, repeat('d', 64), 'Hist Sample Person', '0771110000', 'Sample Position', 'Selected')`,
      [batch.id],
    );
    const snapshot = JSON.stringify(await h.query('SELECT * FROM historical_interview_records'));
    await register(person(), { now: OCT_21 });
    assert.equal(
      JSON.stringify(await h.query('SELECT * FROM historical_interview_records')),
      snapshot,
    );
  });
});

describe('the Candidate ID preview', () => {
  const preview = (who) => h.api('/candidates/next-id', { cookie: who?.cookie });
  const snapshot = async () =>
    Promise.all(
      ['candidates', 'audit_log', 'stage_history'].map(
        async (t) => (await h.query(`SELECT count(*)::int AS n FROM ${t}`))[0].n,
      ),
    );

  test('shows the ID the next save would get, and reserves nothing', async () => {
    const before = await snapshot();
    const first = await preview(user);
    const second = await preview(user);
    assert.equal(first.status, 200, JSON.stringify(first.body));
    assert.equal(first.body.preview, true);
    assert.match(first.body.candidateCode, /^\d{10,}$/);
    assert.ok(first.body.candidateCode.startsWith(candidateIdPrefix()));
    assert.equal(second.body.candidateCode, first.body.candidateCode);
    assert.deepEqual(await snapshot(), before);
  });

  test('is the ID the next save really gets, and moves on after it', async () => {
    const shown = (await preview(user)).body.candidateCode;
    const saved = await h.api('/candidates', {
      method: 'POST',
      cookie: user.cookie,
      body: person(),
    });
    assert.equal(saved.body.candidate.candidateCode, shown);
    assert.notEqual((await preview(user)).body.candidateCode, shown);
  });

  test('is not read as a candidate number', async () => {
    assert.equal((await preview(user)).status, 200);
    assert.equal((await h.api('/candidates/not-a-number', { cookie: user.cookie })).status, 404);
  });

  test('needs permission to add candidates, and a sign-in', async () => {
    const lead = await h.signedIn({ roleCode: 'team_lead' });
    assert.equal((await preview(lead)).status, 403);
    assert.equal((await preview(null)).status, 401);
  });
});

describe('creating positions needs the existing administrator permission', () => {
  test('HR cannot create a position or a source, and nothing is added', async () => {
    const count = async () =>
      (
        await h.query(
          'SELECT (SELECT count(*) FROM positions) + (SELECT count(*) FROM sources) AS n',
        )
      )[0].n;
    const before = await count();
    for (const list of ['positions', 'sources']) {
      const res = await h.api(`/lookups/${list}`, {
        method: 'POST',
        cookie: user.cookie,
        body: { name: 'Rocket Scientist' },
      });
      assert.equal(res.status, 403, list);
    }
    assert.equal(await count(), before);
  });
});
