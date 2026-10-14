import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { createApp } from '../src/app.js';
import { createTestDatabase, createTestRole, createTestUser } from './helpers/testDb.js';

// Integration tests: a real server and real tables, in a throwaway schema.
// Every name, phone number and address below is made up.

let db;
let server;
let baseUrl;
let admin; // holds every permission
let viewer; // may only view candidates
let outsider; // holds no permission at all
let positions;
let sources;
let nextCode = 1;

async function api(path, { method = 'GET', body, cookie } = {}) {
  const res = await fetch(`${baseUrl}/api${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
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

// A complete, valid candidate. Each call gets its own ID, phone and email.
function candidate(overrides = {}) {
  const n = nextCode;
  nextCode += 1;
  return {
    candidateCode: `TEST-${String(n).padStart(4, '0')}`,
    fullName: `Sample Person ${n}`,
    phone: `07100${String(n).padStart(5, '0')}`,
    email: `sample.person.${n}@example.test`,
    ...overrides,
  };
}

const create = (body, who = admin) =>
  api('/candidates', { method: 'POST', body, cookie: who.cookie });
const countCandidates = async () =>
  (await db.pool.query('SELECT count(*)::int AS n FROM candidates')).rows[0].n;

before(async () => {
  db = await createTestDatabase();
  server = createApp({ config: db.config, pool: db.pool }).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  await createTestRole(db.pool, 'viewer', ['candidates.view']);
  await createTestRole(db.pool, 'outsider', []);
  admin = await signedIn();
  viewer = await signedIn({ roleCode: 'viewer' });
  outsider = await signedIn({ roleCode: 'outsider' });

  const lookup = async (list, name) =>
    (await api(`/lookups/${list}`, { method: 'POST', body: { name }, cookie: admin.cookie })).body
      .item;
  positions = {
    a: await lookup('positions', 'Test Position A'),
    b: await lookup('positions', 'Test Position B'),
  };
  sources = {
    a: await lookup('sources', 'Test Source A'),
    b: await lookup('sources', 'Test Source B'),
  };
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await db.cleanup();
});

describe('access', () => {
  test('every candidate route refuses a visitor who is not signed in', async () => {
    assert.equal((await api('/candidates')).status, 401);
    assert.equal((await api('/candidates/1')).status, 401);
    assert.equal((await api('/candidates', { method: 'POST', body: candidate() })).status, 401);
    assert.equal((await api('/candidates/1', { method: 'PUT', body: candidate() })).status, 401);
    assert.equal((await api('/lookups/positions')).status, 401);
  });

  test('a user without the view permission is refused', async () => {
    assert.equal((await api('/candidates', { cookie: outsider.cookie })).status, 403);
    assert.equal((await api('/lookups/positions', { cookie: outsider.cookie })).status, 403);
  });

  test('a view-only user can read but cannot create or edit', async () => {
    const created = (await create(candidate())).body.candidate;

    assert.equal((await api('/candidates', { cookie: viewer.cookie })).status, 200);
    assert.equal((await api(`/candidates/${created.id}`, { cookie: viewer.cookie })).status, 200);
    assert.equal((await create(candidate(), viewer)).status, 403);
    assert.equal(
      (
        await api(`/candidates/${created.id}`, {
          method: 'PUT',
          body: candidate(),
          cookie: viewer.cookie,
        })
      ).status,
      403,
    );
  });

  test('only an administrator can add a position or source', async () => {
    const res = await api('/lookups/positions', {
      method: 'POST',
      body: { name: 'Not Allowed' },
      cookie: viewer.cookie,
    });

    assert.equal(res.status, 403);
  });
});

describe('creating a candidate', () => {
  test('saves every field and starts the candidate at "Applied"', async () => {
    const input = candidate({
      address: '12 Example Road\nSample Town',
      olMaths: 'A',
      alResult: '3 passes',
      alStream: 'Sample Stream',
      otherEducation: 'Sample diploma',
      positionId: positions.a.id,
      sourceId: sources.a.id,
      cvUrl: 'https://files.example.test/cv/sample.pdf',
      companyCvUrl: 'https://files.example.test/company-cv/sample.pdf',
      hrComment: 'Sample comment',
    });
    const res = await create(input);

    assert.equal(res.status, 201);
    const saved = res.body.candidate;
    for (const [field, value] of Object.entries(input)) assert.equal(saved[field], value, field);
    assert.deepEqual(saved.position, { id: positions.a.id, name: 'Test Position A' });
    assert.deepEqual(saved.source, { id: sources.a.id, name: 'Test Source A' });
    assert.deepEqual(saved.stage, { code: 'applied', name: 'Applied' });
    assert.equal(saved.companyCvStatus, 'not_sent');
    assert.equal(saved.createdBy, 'Test User');

    const history = await db.pool.query(
      'SELECT from_stage, to_stage, changed_by FROM stage_history WHERE candidate_id = $1',
      [saved.id],
    );
    assert.deepEqual(history.rows, [
      { from_stage: null, to_stage: 'applied', changed_by: String(admin.id) },
    ]);
  });

  test('needs only the Candidate ID and the name', async () => {
    const res = await create({ candidateCode: 'TEST-MINIMAL', fullName: 'Minimal Person' });

    assert.equal(res.status, 201);
    assert.equal(res.body.candidate.phone, null);
    assert.equal(res.body.candidate.position, null);
  });

  test('reports each missing required field', async () => {
    const before = await countCandidates();
    const res = await create({ phone: '0710000000' });

    assert.equal(res.status, 422);
    assert.equal(res.body.error, 'validation_failed');
    assert.deepEqual(Object.keys(res.body.fields).sort(), ['candidateCode', 'fullName']);
    assert.equal(await countCandidates(), before);
  });

  test('reports badly formed values field by field', async () => {
    const res = await create(
      candidate({
        phone: '12345',
        email: 'not-an-email',
        cvUrl: 'ftp://files.example.test/cv.pdf',
        companyCvUrl: 'just some words',
        fullName: 'x'.repeat(151),
        sourceId: 'abc',
      }),
    );

    assert.equal(res.status, 422);
    assert.deepEqual(Object.keys(res.body.fields).sort(), [
      'companyCvUrl',
      'cvUrl',
      'email',
      'fullName',
      'phone',
      'sourceId',
    ]);
  });

  test('refuses a position or source that does not exist', async () => {
    const res = await create(candidate({ positionId: 999999, sourceId: 999999 }));

    assert.equal(res.status, 422);
    assert.deepEqual(Object.keys(res.body.fields).sort(), ['positionId', 'sourceId']);
  });

  test('refuses a Candidate ID that is already used, whatever its letter case', async () => {
    const first = candidate();
    await create(first);
    const res = await create(candidate({ candidateCode: first.candidateCode.toLowerCase() }));

    assert.equal(res.status, 422);
    assert.match(res.body.fields.candidateCode, /already used/);
  });

  test('refuses a position that has been switched off', async () => {
    const { rows } = await db.pool.query(
      `INSERT INTO positions (name, is_active) VALUES ('Retired Position', false) RETURNING id`,
    );
    const res = await create(candidate({ positionId: Number(rows[0].id) }));

    assert.equal(res.status, 422);
    assert.match(res.body.fields.positionId, /no longer in use/);
  });
});

describe('phone numbers', () => {
  test('are stored as text with the leading zero kept', async () => {
    const res = await create(candidate({ phone: '0771234567' }));
    const { rows } = await db.pool.query('SELECT phone FROM candidates WHERE id = $1', [
      res.body.candidate.id,
    ]);

    assert.equal(res.body.candidate.phone, '0771234567');
    assert.equal(rows[0].phone, '0771234567');
    assert.equal(typeof rows[0].phone, 'string');
  });

  test('the column is text, not a number', async () => {
    const { rows } = await db.pool.query(
      `SELECT data_type FROM information_schema.columns
        WHERE table_schema = $1 AND table_name = 'candidates' AND column_name = 'phone'`,
      [db.schema],
    );

    assert.equal(rows[0].data_type, 'text');
  });

  test('spaces, dashes and brackets are removed; the digits are untouched', async () => {
    const res = await create(candidate({ phone: ' (077) 222-3344 ' }));

    assert.equal(res.body.candidate.phone, '0772223344');
  });

  test('a phone sent as a number is refused, because its leading zero is already lost', async () => {
    const res = await create(candidate({ phone: 771234567 }));

    assert.equal(res.status, 422);
    assert.match(res.body.fields.phone, /text/);
  });

  test('the database itself refuses a badly formed phone', async () => {
    await assert.rejects(
      db.pool.query(
        `INSERT INTO candidates (candidate_code, full_name, phone) VALUES ('TEST-BADPHONE', 'X', '077 123')`,
      ),
      /candidates_phone_format/,
    );
  });
});

describe('duplicate warnings', () => {
  test('the same phone in another format is warned about, and nothing is saved', async () => {
    const first = (await create(candidate({ phone: '0773334455' }))).body.candidate;
    const before = await countCandidates();
    const res = await create(candidate({ phone: '+94 77 333 4455' }));

    assert.equal(res.status, 409);
    assert.equal(res.body.error, 'possible_duplicate');
    assert.equal(res.body.duplicates.length, 1);
    assert.equal(res.body.duplicates[0].id, first.id);
    assert.deepEqual(res.body.duplicates[0].matchedOn, ['phone']);
    assert.equal(await countCandidates(), before);
  });

  test('the same email is warned about, whatever its letter case', async () => {
    const first = candidate();
    await create(first);
    const res = await create(candidate({ email: first.email.toUpperCase() }));

    assert.equal(res.status, 409);
    assert.deepEqual(res.body.duplicates[0].matchedOn, ['email']);
  });

  test('the same name for the same position is warned about', async () => {
    await create(candidate({ fullName: 'Repeated  Name', positionId: positions.b.id }));
    const res = await create(candidate({ fullName: 'repeated name', positionId: positions.b.id }));

    assert.equal(res.status, 409);
    assert.deepEqual(res.body.duplicates[0].matchedOn, ['name and position']);
  });

  test('the same name for a different position is not a warning', async () => {
    await create(candidate({ fullName: 'Shared Name', positionId: positions.a.id }));
    const res = await create(candidate({ fullName: 'Shared Name', positionId: positions.b.id }));

    assert.equal(res.status, 201);
  });

  test('after confirming, the candidate is saved as a separate record and nothing is merged', async () => {
    const first = (await create(candidate({ phone: '0774445566' }))).body.candidate;
    const second = candidate({ phone: '0774445566' });
    const res = await create({ ...second, confirmDuplicate: true });

    assert.equal(res.status, 201);
    assert.notEqual(res.body.candidate.id, first.id);
    assert.equal(res.body.candidate.fullName, second.fullName);
    // The first record is unchanged.
    const original = await api(`/candidates/${first.id}`, { cookie: admin.cookie });
    assert.equal(original.body.candidate.fullName, first.fullName);

    const audit = await db.pool.query(
      `SELECT details FROM audit_log WHERE action = 'CANDIDATE_CREATE' AND entity_id = $1`,
      [res.body.candidate.id],
    );
    assert.deepEqual(audit.rows[0].details, { savedDespiteLikelyDuplicates: [first.id] });
  });

  test('phone and email are not unique in the database', async () => {
    // Queried from pg_index directly, not the pg_indexes view: the view runs
    // pg_get_indexdef() over every index in the database, which fails if a
    // parallel test file drops its throwaway schema mid-scan.
    const { rows } = await db.pool.query(
      `SELECT c.relname AS indexname
         FROM pg_index i
         JOIN pg_class c ON c.oid = i.indexrelid
         JOIN pg_class t ON t.oid = i.indrelid
         JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = $1 AND t.relname = 'candidates' AND i.indisunique
        ORDER BY 1`,
      [db.schema],
    );

    assert.deepEqual(
      rows.map((row) => row.indexname),
      ['candidates_candidate_code_key', 'candidates_pkey'],
    );
  });
});

describe('listing candidates', () => {
  // A separate group of candidates that the searches below can pick out.
  let listed;

  before(async () => {
    const make = async (overrides) => (await create(candidate(overrides))).body.candidate;
    listed = {
      zebra: await make({
        fullName: 'Zebra Listing',
        positionId: positions.a.id,
        sourceId: sources.a.id,
        phone: '0759990001',
        email: 'zebra.listing@example.test',
        candidateCode: 'LIST-ZEBRA',
      }),
      yak: await make({
        fullName: 'Yak Listing',
        positionId: positions.a.id,
        sourceId: sources.b.id,
        phone: '0759990002',
      }),
      xerus: await make({
        fullName: 'Xerus Listing',
        positionId: positions.b.id,
        sourceId: sources.b.id,
        phone: '0759990003',
      }),
    };
  });

  const list = (query = '') => api(`/candidates${query}`, { cookie: admin.cookie });
  const names = (res) => res.body.items.map((item) => item.fullName);

  test('returns a page of candidates with the total', async () => {
    const res = await list();

    assert.equal(res.status, 200);
    assert.equal(res.body.page, 1);
    assert.equal(res.body.pageSize, 20);
    assert.equal(res.body.total, await countCandidates());
    assert.ok(res.body.items.length > 0);
  });

  test('returns only the fields the list screen needs', async () => {
    const res = await list('?search=Zebra');

    assert.deepEqual(Object.keys(res.body.items[0]).sort(), [
      'candidateCode',
      'createdAt',
      'email',
      'fullName',
      'id',
      'phone',
      'position',
      'source',
      'stage',
    ]);
  });

  test('newest first by default', async () => {
    const res = await list('?search=Listing');

    assert.deepEqual(names(res), ['Xerus Listing', 'Yak Listing', 'Zebra Listing']);
  });

  test('searches by name, Candidate ID, email and phone digits', async () => {
    assert.deepEqual(names(await list('?search=zebra')), ['Zebra Listing']);
    assert.deepEqual(names(await list('?search=list-zeb')), ['Zebra Listing']);
    assert.deepEqual(names(await list('?search=zebra.listing@')), ['Zebra Listing']);
    assert.deepEqual(names(await list(`?search=${encodeURIComponent('075 999 0002')}`)), [
      'Yak Listing',
    ]);
  });

  test('treats % and _ in a search as ordinary characters', async () => {
    assert.equal((await list(`?search=${encodeURIComponent('%')}`)).body.total, 0);
    assert.equal((await list('?search=_')).body.total, 0);
  });

  test('filters by position, by source and by both', async () => {
    assert.deepEqual(names(await list(`?search=Listing&positionId=${positions.a.id}`)), [
      'Yak Listing',
      'Zebra Listing',
    ]);
    assert.deepEqual(names(await list(`?search=Listing&sourceId=${sources.b.id}`)), [
      'Xerus Listing',
      'Yak Listing',
    ]);
    assert.deepEqual(
      names(await list(`?search=Listing&positionId=${positions.a.id}&sourceId=${sources.b.id}`)),
      ['Yak Listing'],
    );
  });

  test('filters by stage', async () => {
    await db.pool.query(
      `UPDATE pipeline_status SET current_stage = 'on_hold', hold_reason = 'Sample reason' WHERE candidate_id = $1`,
      [listed.yak.id],
    );

    assert.deepEqual(names(await list('?search=Listing&stage=on_hold')), ['Yak Listing']);
    assert.deepEqual(names(await list('?search=Listing&stage=applied')), [
      'Xerus Listing',
      'Zebra Listing',
    ]);
  });

  test('pages through the results', async () => {
    const first = await list('?search=Listing&pageSize=2&page=1');
    const second = await list('?search=Listing&pageSize=2&page=2');

    assert.equal(first.body.total, 3);
    assert.deepEqual(names(first), ['Xerus Listing', 'Yak Listing']);
    assert.deepEqual(names(second), ['Zebra Listing']);
  });

  test('sorts by name when asked, and ignores an unknown sort', async () => {
    assert.deepEqual(names(await list('?search=Listing&sort=name&order=asc')), [
      'Xerus Listing',
      'Yak Listing',
      'Zebra Listing',
    ]);
    assert.equal(
      (await list(`?search=Listing&sort=${encodeURIComponent('id; DROP TABLE candidates')}`))
        .status,
      200,
    );
    assert.ok((await countCandidates()) > 0);
  });

  test('never returns more than 100 at once', async () => {
    assert.equal((await list('?pageSize=5000')).body.pageSize, 100);
  });
});

describe('viewing a candidate', () => {
  test('returns the full record', async () => {
    const created = (await create(candidate({ hrComment: 'Details comment' }))).body.candidate;
    const res = await api(`/candidates/${created.id}`, { cookie: admin.cookie });

    assert.equal(res.status, 200);
    assert.equal(res.body.candidate.hrComment, 'Details comment');
    assert.equal(res.body.candidate.stage.name, 'Applied');
  });

  test('answers "not found" for an unknown or malformed id', async () => {
    assert.equal((await api('/candidates/999999', { cookie: admin.cookie })).status, 404);
    assert.equal((await api('/candidates/abc', { cookie: admin.cookie })).status, 404);
    assert.equal((await api('/candidates/1.5', { cookie: admin.cookie })).status, 404);
  });
});

describe('editing a candidate', () => {
  const edit = (id, body, who = admin) =>
    api(`/candidates/${id}`, { method: 'PUT', body, cookie: who.cookie });

  test('saves the changes and records who made them', async () => {
    const input = candidate({ olMaths: 'B' });
    const created = (await create(input)).body.candidate;
    const editor = await signedIn();
    const res = await edit(
      created.id,
      { ...input, olMaths: 'A', hrComment: 'Updated comment' },
      editor,
    );

    assert.equal(res.status, 200);
    assert.equal(res.body.candidate.olMaths, 'A');
    assert.equal(res.body.candidate.hrComment, 'Updated comment');
    assert.equal(res.body.candidate.fullName, input.fullName);

    const { rows } = await db.pool.query(
      'SELECT created_by, updated_by FROM candidates WHERE id = $1',
      [created.id],
    );
    assert.deepEqual(rows[0], { created_by: String(admin.id), updated_by: String(editor.id) });
  });

  test('validates the changes like a new candidate', async () => {
    const input = candidate();
    const created = (await create(input)).body.candidate;
    const res = await edit(created.id, { ...input, fullName: '', email: 'broken' });

    assert.equal(res.status, 422);
    assert.deepEqual(Object.keys(res.body.fields).sort(), ['email', 'fullName']);
  });

  test('does not treat the candidate as a duplicate of itself', async () => {
    const input = candidate();
    const created = (await create(input)).body.candidate;

    assert.equal((await edit(created.id, { ...input, address: 'New sample address' })).status, 200);
  });

  // Found in a real browser run: two records confirmed as separate people kept
  // raising the warning on every later edit.
  test('does not repeat the warning when only an unrelated field changes', async () => {
    const shared = { phone: '0775556677' };
    const first = candidate(shared);
    await create(first);
    const second = candidate(shared);
    const created = (await create({ ...second, confirmDuplicate: true })).body.candidate;

    const res = await edit(created.id, { ...second, hrComment: 'Only the comment changed' });

    assert.equal(res.status, 200);
    assert.equal(res.body.candidate.hrComment, 'Only the comment changed');
  });

  test('warns when a change makes it look like another candidate', async () => {
    const other = candidate();
    await create(other);
    const input = candidate();
    const created = (await create(input)).body.candidate;

    const warned = await edit(created.id, { ...input, phone: other.phone });
    assert.equal(warned.status, 409);

    const confirmed = await edit(created.id, {
      ...input,
      phone: other.phone,
      confirmDuplicate: true,
    });
    assert.equal(confirmed.status, 200);
    assert.equal(confirmed.body.candidate.phone, other.phone);
  });

  test('cannot take a Candidate ID that belongs to someone else', async () => {
    const other = candidate();
    await create(other);
    const input = candidate();
    const created = (await create(input)).body.candidate;
    const res = await edit(created.id, { ...input, candidateCode: other.candidateCode });

    assert.equal(res.status, 422);
    assert.ok(res.body.fields.candidateCode);
  });

  test('answers "not found" for an unknown candidate', async () => {
    assert.equal((await edit(999999, candidate())).status, 404);
  });
});

describe('audit log', () => {
  const auditFor = async (id) =>
    (
      await db.pool.query(
        `SELECT action, actor_user_id, entity_type, old_values, new_values FROM audit_log
          WHERE entity_type = 'candidates' AND entity_id = $1 ORDER BY id`,
        [id],
      )
    ).rows;

  test('creating a candidate is recorded with who did it', async () => {
    const input = candidate();
    const created = (await create(input)).body.candidate;
    const rows = await auditFor(created.id);

    assert.equal(rows.length, 1);
    assert.equal(rows[0].action, 'CANDIDATE_CREATE');
    assert.equal(rows[0].actor_user_id, String(admin.id));
    assert.equal(rows[0].new_values.fullName, input.fullName);
    assert.equal(rows[0].new_values.phone, input.phone);
  });

  test('editing records only the fields that changed, with old and new values', async () => {
    const input = candidate({ alStream: 'Old Stream' });
    const created = (await create(input)).body.candidate;
    await api(`/candidates/${created.id}`, {
      method: 'PUT',
      body: { ...input, alStream: 'New Stream' },
      cookie: admin.cookie,
    });
    const update = (await auditFor(created.id))[1];

    assert.equal(update.action, 'CANDIDATE_UPDATE');
    assert.deepEqual(update.old_values, { alStream: 'Old Stream' });
    assert.deepEqual(update.new_values, { alStream: 'New Stream' });
  });

  test('saving without changing anything records nothing', async () => {
    const input = candidate();
    const created = (await create(input)).body.candidate;
    const res = await api(`/candidates/${created.id}`, {
      method: 'PUT',
      body: input,
      cookie: admin.cookie,
    });

    assert.equal(res.status, 200);
    assert.equal((await auditFor(created.id)).length, 1);
  });

  test('a refused save records nothing', async () => {
    const before = (
      await db.pool.query(
        `SELECT count(*)::int AS n FROM audit_log WHERE action LIKE 'CANDIDATE_%'`,
      )
    ).rows[0].n;
    await create({ fullName: '' });
    const after = (
      await db.pool.query(
        `SELECT count(*)::int AS n FROM audit_log WHERE action LIKE 'CANDIDATE_%'`,
      )
    ).rows[0].n;

    assert.equal(after, before);
  });
});

describe('lookup lists', () => {
  test('positions and sources start empty; nothing is invented', async () => {
    const fresh = await createTestDatabase();
    try {
      const { rows } = await fresh.pool.query(
        'SELECT (SELECT count(*) FROM positions)::int AS positions, (SELECT count(*) FROM sources)::int AS sources',
      );
      assert.deepEqual(rows[0], { positions: 0, sources: 0 });
    } finally {
      await fresh.cleanup();
    }
  });

  test('lists the values an administrator has added', async () => {
    const res = await api('/lookups/positions', { cookie: admin.cookie });

    assert.equal(res.status, 200);
    assert.ok(res.body.items.some((item) => item.name === 'Test Position A' && item.isActive));
  });

  test('refuses a blank name and a name that already exists', async () => {
    const add = (name) =>
      api('/lookups/sources', { method: 'POST', body: { name }, cookie: admin.cookie });

    assert.equal((await add('   ')).status, 422);
    assert.equal((await add('test source a')).status, 422);
  });

  test('returns the twelve pipeline stages from the task guide, in order', async () => {
    const res = await api('/lookups/stages', { cookie: admin.cookie });

    assert.deepEqual(
      res.body.items.map((stage) => stage.name),
      [
        'Applied',
        'Phone Screened',
        'Interview Scheduled',
        'Interviewed',
        'Selected',
        'Offer Sent',
        'Offer Accepted',
        'Joined',
        'On Hold',
        'Rejected',
        'Not Attended',
        'No Response',
      ],
    );
  });

  test('an unknown list is not found', async () => {
    assert.equal((await api('/lookups/users', { cookie: admin.cookie })).status, 404);
  });
});

describe('pipeline rules in the database', () => {
  test('a hold reason is required when a candidate is put on hold', async () => {
    const created = (await create(candidate())).body.candidate;

    await assert.rejects(
      db.pool.query(
        `UPDATE pipeline_status SET current_stage = 'on_hold' WHERE candidate_id = $1`,
        [created.id],
      ),
      /pipeline_status_hold_reason_required/,
    );
  });

  test('a reject reason is required when a candidate is rejected', async () => {
    const created = (await create(candidate())).body.candidate;

    await assert.rejects(
      db.pool.query(
        `UPDATE pipeline_status SET current_stage = 'rejected' WHERE candidate_id = $1`,
        [created.id],
      ),
      /pipeline_status_reject_reason_required/,
    );
  });

  test('a stage must be one of the listed stages', async () => {
    const created = (await create(candidate())).body.candidate;

    await assert.rejects(
      db.pool.query(
        `UPDATE pipeline_status SET current_stage = 'made_up_stage' WHERE candidate_id = $1`,
        [created.id],
      ),
      /pipeline_status_current_stage_fkey/,
    );
  });
});
