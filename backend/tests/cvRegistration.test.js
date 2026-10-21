// Integration tests for CV extraction -> Candidate Registration. They drive
// the real routes and SQL over a throwaway IN-MEMORY Postgres (PGlite) with
// the real migrations, so recruitment_system_dev and every other database
// stay untouched. Documents are fictional, built in memory; the network is a
// stub. Names, phones and emails are all made up.

import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { createUploadLink } from '../src/modules/company-cv/companyCv.service.js';
import { FetchRefused } from '../src/modules/cv-extraction/safeFetch.js';
import { FULL_CV, SPARSE_CV, buildDocx, buildPdf } from './helpers/fictionalCv.js';
import { startMemoryHarness } from './helpers/memoryDb.js';

const PDF_TYPE = 'application/pdf';
const DOCX_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

let h;
let hr;
let lead; // Team Lead: holds no candidates.edit
let storageDir;
let linkDocument = null; // what the stubbed link fetcher returns, or throws

const extractFile = (buffer, who = hr, type = PDF_TYPE) =>
  h.api('/candidates/extract-cv/file', {
    method: 'POST',
    cookie: who?.cookie,
    headers: { 'Content-Type': type },
    rawBody: buffer,
  });
const extractLink = (url, who = hr) =>
  h.api('/candidates/extract-cv/link', { method: 'POST', cookie: who?.cookie, body: { url } });
const register = (body, who = hr) =>
  h.api('/candidates', { method: 'POST', cookie: who.cookie, body });
const count = async (table) => (await h.query(`SELECT count(*)::int AS n FROM ${table}`))[0].n;

before(async () => {
  storageDir = await mkdtemp(path.join(tmpdir(), 'cv-registration-test-'));
  h = await startMemoryHarness({
    config: { devStorageDir: storageDir },
    extraDeps: {
      fetchDocument: async () => {
        if (linkDocument instanceof Error) throw linkDocument;
        return { buffer: linkDocument };
      },
    },
  });
  hr = await h.signedIn({ roleCode: 'hr' });
  lead = await h.signedIn({ roleCode: 'team_lead' });
});

after(async () => {
  await h.stop();
  await rm(storageDir, { recursive: true, force: true });
});

describe('reading a CV', () => {
  test('1. a PDF upload is extracted', async () => {
    const res = await extractFile(await buildPdf(FULL_CV));
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.extraction.status, 'extracted');
    assert.equal(res.body.extraction.formDraft.fullName, 'Nimali Testperson');
    assert.equal(res.body.extraction.formDraft.phone, '0700000001');
    assert.equal(res.body.cvUrl, null);
  });

  test('2. a DOCX upload is extracted', async () => {
    const res = await extractFile(await buildDocx(FULL_CV), hr, DOCX_TYPE);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.extraction.formDraft.email, 'nimali.testperson@example.test');
    assert.equal(res.body.extraction.formDraft.olMaths, 'A');
  });

  test('3. a valid CV link is fetched and extracted, and the link is offered as the CV Link', async () => {
    linkDocument = await buildPdf(FULL_CV);
    const res = await extractLink('https://cv.example.test/nimali.pdf');
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.extraction.formDraft.fullName, 'Nimali Testperson');
    assert.equal(res.body.cvUrl, 'https://cv.example.test/nimali.pdf');
  });

  test('4. an inaccessible link gives a clear error and reads nothing', async () => {
    linkDocument = new FetchRefused(
      'needs_login',
      'The link needs a sign-in, which is not supported.',
    );
    const res = await extractLink('https://private.example.test/cv.pdf');
    assert.equal(res.status, 422);
    assert.equal(res.body.error, 'link_refused');
    assert.equal(res.body.reason, 'needs_login');
    assert.match(res.body.message, /sign-in/);
  });

  test('5. a private or internal link is blocked by the real fetcher, without any network use', async () => {
    // A second app WITHOUT the stub, so the real safe fetcher is in the path.
    const real = await startMemoryHarness();
    try {
      const user = await real.signedIn({ roleCode: 'hr' });
      for (const url of [
        'https://localhost/cv.pdf',
        'https://127.0.0.1/cv.pdf',
        'https://169.254.169.254/latest/meta-data/',
        'https://[::1]/cv.pdf',
        'http://cv.example.test/cv.pdf',
        'https://user:pw@cv.example.test/cv.pdf',
      ]) {
        const res = await real.api('/candidates/extract-cv/link', {
          method: 'POST',
          cookie: user.cookie,
          body: { url },
        });
        assert.equal(res.status, 422, url);
        assert.equal(res.body.error, 'link_refused', url);
        assert.equal(JSON.stringify(res.body).includes('pw@'), false, url);
      }
    } finally {
      await real.stop();
    }
  });

  test('6. missing fields are listed for review and are not invented', async () => {
    const res = await extractFile(await buildDocx(SPARSE_CV), hr, DOCX_TYPE);
    const { extraction } = res.body;
    assert.equal(extraction.status, 'partial');
    assert.ok(extraction.review.unavailable.includes('phone'));
    assert.ok(extraction.review.unavailable.includes('address'));
    assert.ok(extraction.review.uncertain.includes('fullName'));
    assert.deepEqual(Object.keys(extraction.formDraft), ['email']);
    assert.equal(res.body.registration.candidateIdRequired, true);
  });

  test('a file that cannot be read is an error, not a partial result', async () => {
    const res = await extractFile(Buffer.from('plain text, not a CV file'));
    assert.equal(res.status, 422);
    assert.equal(res.body.error, 'extraction_failed');
    assert.equal(res.body.reason, 'unsupported_format');

    const wrongType = await extractFile(await buildPdf(FULL_CV), hr, 'text/plain');
    assert.equal(wrongType.status, 415);
  });

  test('11. unauthorised staff are denied, and nothing is read', async () => {
    const pdf = await buildPdf(FULL_CV);
    assert.equal((await extractFile(pdf, lead)).status, 403);
    assert.equal((await extractLink('https://cv.example.test/a.pdf', lead)).status, 403);
    assert.equal((await extractFile(pdf, null)).status, 401);
    assert.equal((await extractLink('https://cv.example.test/a.pdf', null)).status, 401);
  });
});

describe('registering from an extraction', () => {
  test('reading a CV never creates or changes any record', async () => {
    const before = [
      await count('candidates'),
      await count('audit_log'),
      await count('stage_history'),
    ];
    await extractFile(await buildPdf(FULL_CV));
    await extractFile(Buffer.from('not a cv'));
    linkDocument = await buildPdf(FULL_CV);
    await extractLink('https://cv.example.test/x.pdf');
    const after = [
      await count('candidates'),
      await count('audit_log'),
      await count('stage_history'),
    ];
    assert.deepEqual(after, before);
  });

  test('8. a valid new candidate is registered through the existing backend', async () => {
    const read = await extractFile(await buildPdf(FULL_CV));
    const { formDraft } = read.body.extraction;
    assert.deepEqual(read.body.duplicates, []);

    // HR completes the Candidate ID, which extraction never supplies.
    const res = await register({ ...formDraft, candidateCode: 'CVX-0001' });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const candidate = res.body.candidate;
    assert.equal(candidate.candidateCode, 'CVX-0001');
    assert.equal(candidate.fullName, 'Nimali Testperson');
    assert.equal(candidate.phone, '0700000001');
    assert.equal(candidate.olMaths, 'A');
    assert.equal(candidate.alStream, 'Physical Science');
    assert.equal(candidate.stage.code, 'applied');

    const [saved] = await h.query('SELECT id, phone FROM candidates WHERE candidate_code = $1', [
      'CVX-0001',
    ]);
    assert.equal(saved.phone, '0700000001');
    const history = await h.query('SELECT 1 FROM stage_history WHERE candidate_id = $1', [
      saved.id,
    ]);
    assert.equal(history.length, 1);
    const audit = await h.query(
      `SELECT action FROM audit_log WHERE entity_type = 'candidates' AND entity_id = $1`,
      [saved.id],
    );
    assert.deepEqual(
      audit.map((a) => a.action),
      ['CANDIDATE_CREATE'],
    );
  });

  test('9. without a Candidate ID nothing is registered', async () => {
    const read = await extractFile(await buildDocx(FULL_CV), hr, DOCX_TYPE);
    const total = await count('candidates');
    const res = await register({ ...read.body.extraction.formDraft });
    assert.equal(res.status, 422);
    assert.ok(res.body.fields.candidateCode);
    assert.equal(await count('candidates'), total);
  });

  test('7. a CV of an existing candidate shows the match and creates no duplicate', async () => {
    const total = await count('candidates');
    const read = await extractFile(await buildPdf(FULL_CV)); // Nimali, registered above
    assert.equal(read.body.duplicates.length, 1);
    assert.equal(read.body.duplicates[0].candidateCode, 'CVX-0001');
    assert.ok(read.body.duplicates[0].matchedOn.includes('phone'));
    assert.ok(read.body.duplicates[0].matchedOn.includes('email'));

    // Saving it anyway is refused with the existing warning, and stores nothing.
    const res = await register({ ...read.body.extraction.formDraft, candidateCode: 'CVX-0002' });
    assert.equal(res.status, 409);
    assert.equal(res.body.error, 'possible_duplicate');
    assert.equal(await count('candidates'), total);

    // Nothing was merged or changed on the existing record.
    const [existing] = await h.query(
      'SELECT full_name, phone FROM candidates WHERE candidate_code = $1',
      ['CVX-0001'],
    );
    assert.equal(existing.full_name, 'Nimali Testperson');
  });

  test('10. repeated and simultaneous requests create only one record', async () => {
    const body = {
      candidateCode: 'CVX-REPEAT',
      fullName: 'Ravi Samplestudent',
      phone: '0700000042',
      email: 'ravi.repeat@example.test',
    };
    const results = await Promise.all([register(body), register(body), register(body)]);
    const statuses = results.map((r) => r.status).sort();
    // At most one wins; every other request is refused (same ID, or the
    // existing duplicate warning) and stores nothing.
    assert.equal(statuses.filter((s) => s === 201).length, 1, JSON.stringify(statuses));
    assert.ok(
      statuses.every((s) => [201, 409, 422].includes(s)),
      JSON.stringify(statuses),
    );
    const rows = await h.query('SELECT 1 FROM candidates WHERE lower(candidate_code) = $1', [
      'cvx-repeat',
    ]);
    assert.equal(rows.length, 1);

    // A later click on the same data is warned about, not saved again.
    const again = await register({ ...body, candidateCode: 'CVX-REPEAT-2' });
    assert.equal(again.status, 409);
    const phoneRows = await h.query('SELECT 1 FROM candidates WHERE phone = $1', ['0700000042']);
    assert.equal(phoneRows.length, 1);
  });

  test('14. a failed extraction inserts no candidate', async () => {
    const total = await count('candidates');
    const res = await extractFile(Buffer.from('%PDF-1.4 damaged'));
    assert.equal(res.status, 422);
    assert.equal(await count('candidates'), total);
  });
});

describe('existing features are preserved', () => {
  test("12. a candidate's own Company CV upload link works exactly as before", async () => {
    const created = await register({
      candidateCode: 'CVX-INVITED',
      fullName: 'Invited Sample',
      phone: '0700000077',
      email: 'invited.sample@example.test',
    });
    assert.equal(created.status, 201);
    const candidateId = created.body.candidate.id;
    const before = await count('candidates');

    const url = await createUploadLink(h.pool, { candidateId, baseUrl: 'http://app.example.test' });
    const token = url.split('/').pop();
    const upload = () =>
      h.raw(`/api/public/company-cv/${token}`, {
        method: 'PUT',
        headers: { 'Content-Type': PDF_TYPE },
        rawBody: Buffer.from('%PDF-1.4\n% made-up sample\n%%EOF\n'),
      });

    assert.equal((await upload()).status, 201);
    const [row] = await h.query(
      'SELECT company_cv_status, company_cv_url FROM candidates WHERE id = $1',
      [candidateId],
    );
    assert.equal(row.company_cv_status, 'received');
    assert.match(row.company_cv_url, /\/api\/company-cv-files\//);
    // The link works once, and it never creates a second candidate.
    assert.equal((await upload()).status, 410);
    assert.equal(await count('candidates'), before);
  });

  test('15. historical recruitment records are untouched and still listed', async () => {
    const [batch] = await h.query(
      `INSERT INTO historical_import_batches (file_name, file_sha256, encoding, record_count, status)
       VALUES ('fictional.csv', repeat('a', 64), 'utf-8', 1, 'completed') RETURNING id`,
    );
    await h.query(
      `INSERT INTO historical_interview_records
         (batch_id, record_number, row_hash, candidate_name, contact_number, position, original_status)
       VALUES ($1, 2, repeat('b', 64), 'Hist Sample Person', '0771110000', 'Sample Position', 'Selected')`,
      [batch.id],
    );
    const snapshot = JSON.stringify(await h.query('SELECT * FROM historical_interview_records'));

    await extractFile(await buildPdf(FULL_CV));
    await register({ candidateCode: 'CVX-AFTER', fullName: 'After Sample', phone: '0700000088' });

    assert.equal(
      JSON.stringify(await h.query('SELECT * FROM historical_interview_records')),
      snapshot,
    );
    const list = await h.api('/recruitment-records?pageSize=100', { cookie: hr.cookie });
    assert.equal(list.status, 200, JSON.stringify(list.body));
    const names = list.body.items.map((item) => item.candidateName);
    assert.ok(names.includes('Hist Sample Person'), JSON.stringify(names));
    assert.ok(names.includes('After Sample'), JSON.stringify(names));
  });
});
