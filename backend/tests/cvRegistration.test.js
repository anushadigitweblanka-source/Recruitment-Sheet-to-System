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
import { candidateIdPrefix } from '../src/modules/candidates/candidateId.js';
import { FetchRefused } from '../src/modules/cv-extraction/safeFetch.js';
import {
  FULL_CV,
  SPARSE_CV,
  TEMPLATE_CV,
  buildDocx,
  buildPdf,
  buildPositionedPdf,
  formTablePlacements,
} from './helpers/fictionalCv.js';
import { startMemoryHarness } from './helpers/memoryDb.js';

const PDF_TYPE = 'application/pdf';
const DOCX_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

let h;
let hr;
let lead; // Team Lead: holds no candidates.edit
let storageDir;
let linkDocument = null; // what the stubbed link fetcher returns, or throws

const extractFile = (buffer, who = hr, type = PDF_TYPE, registerNow = false) =>
  h.api(`/candidates/extract-cv/file${registerNow ? '?register=true' : ''}`, {
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
      // These tests never open a real browser.
      renderPage: async () => {
        throw Object.assign(new Error('no browser'), { reason: 'no_browser' });
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
    assert.deepEqual(extraction.review.uncertain, []);
    assert.deepEqual(Object.keys(extraction.formDraft).sort(), ['email', 'fullName']);
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

describe('reading a CV never saves anything', () => {
  const snapshot = async () =>
    Promise.all(['candidates', 'audit_log', 'stage_history'].map((t) => count(t)));

  test('a preview creates and changes no record, however it is requested', async () => {
    const before = await snapshot();
    await extractFile(await buildPdf(FULL_CV));
    // The old "register" flag no longer does anything.
    await extractFile(await buildPdf(FULL_CV), hr, PDF_TYPE, true);
    await extractFile(Buffer.from('not a cv'));
    linkDocument = await buildPdf(FULL_CV);
    await extractLink('https://cv.example.test/x.pdf');
    assert.deepEqual(await snapshot(), before);
  });

  test('the answer carries the details to fill in, and no registration outcome', async () => {
    const res = await extractFile(await buildPdf(FULL_CV), hr, PDF_TYPE, true);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.registration, undefined);
    assert.equal(res.body.extraction.formDraft.fullName, 'Nimali Testperson');
    assert.deepEqual(res.body.extraction.hints, {
      appliedPosition: null,
      targetPosition: null,
      source: null,
    });
  });

  test('14. a failed extraction inserts no candidate', async () => {
    const total = await count('candidates');
    const res = await extractFile(Buffer.from('%PDF-1.4 damaged'), hr, PDF_TYPE, true);
    assert.equal(res.status, 422);
    assert.equal(await count('candidates'), total);
  });

  test('unauthorised staff cannot read CVs', async () => {
    const res = await extractFile(await buildPdf(FULL_CV), lead, PDF_TYPE, true);
    assert.equal(res.status, 403);
  });
});

describe('saving what was read goes through the existing save', () => {
  test('8. the filled details save with a generated Candidate ID', async () => {
    const read = await extractFile(await buildPdf(FULL_CV));
    const { formDraft } = read.body.extraction;
    assert.deepEqual(read.body.duplicates, []);

    const res = await register(formDraft);
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const candidate = res.body.candidate;
    assert.match(candidate.candidateCode, /^\d{10}$/);
    assert.ok(candidate.candidateCode.startsWith(candidateIdPrefix()));
    assert.equal(candidate.fullName, 'Nimali Testperson');
    assert.equal(candidate.phone, '0700000001');
    assert.equal(candidate.stage.code, 'applied');
    const audit = await h.query(
      `SELECT action FROM audit_log WHERE entity_type = 'candidates' AND entity_id = $1`,
      [candidate.id],
    );
    assert.deepEqual(
      audit.map((a) => a.action),
      ['CANDIDATE_CREATE'],
    );
  });

  test('7. the same CV again shows the existing candidate and save is still warned', async () => {
    const total = await count('candidates');
    const [existing] = await h.query(
      'SELECT candidate_code FROM candidates ORDER BY id DESC LIMIT 1',
    );
    const preview = await extractFile(await buildDocx(FULL_CV), hr, DOCX_TYPE);
    assert.equal(preview.body.duplicates.length, 1);
    assert.equal(preview.body.duplicates[0].candidateCode, existing.candidate_code);
    assert.ok(preview.body.duplicates[0].matchedOn.includes('phone'));

    const res = await register(preview.body.extraction.formDraft);
    assert.equal(res.status, 409);
    assert.equal(res.body.error, 'possible_duplicate');
    assert.equal(await count('candidates'), total);
  });

  test('a link is read and offered as the CV Link; the save keeps it', async () => {
    linkDocument = await buildPdf([
      'Name: Link Samplelady',
      'Phone: 070 000 0055',
      'Email: link.sample@example.test',
    ]);
    const read = await extractLink('https://cv.example.test/link-sample.pdf');
    assert.equal(read.body.cvUrl, 'https://cv.example.test/link-sample.pdf');
    const saved = await register({
      ...read.body.extraction.formDraft,
      cvUrl: read.body.cvUrl,
    });
    assert.equal(saved.status, 201, JSON.stringify(saved.body));
    assert.equal(saved.body.candidate.cvUrl, 'https://cv.example.test/link-sample.pdf');
  });

  test('an uploaded file gives no CV link: none is invented', async () => {
    const read = await extractFile(await buildPdf(SPARSE_CV.concat('Phone: 070 000 0099')));
    assert.equal(read.body.cvUrl, null);
    assert.equal(read.body.extraction.formDraft.cvUrl, undefined);
  });

  test('a save needs no Candidate ID and ignores one that is sent', async () => {
    const res = await register({
      fullName: 'Typed Sample',
      phone: '0700000066',
      candidateCode: 'MINE',
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.notEqual(res.body.candidate.candidateCode, 'MINE');
    assert.match(res.body.candidate.candidateCode, /^\d{10}$/);
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

describe('a CV link and an uploaded file give the same result', () => {
  const SAMPLES = {
    template: TEMPLATE_CV,
    linkedin: [
      'ANUSHA PERERA',
      'Phone: 0771234567',
      'Email: anusha.perera@example.test',
      'LinkedIn: https://www.linkedin.com/in/example-profile',
    ],
    full: [
      'ANUSHA PERERA',
      'Phone: 0771234567',
      'Email: anusha.perera@example.test',
      'Address: 123 Example Road, Colombo, Sri Lanka, O/L Maths A, A/L Stream Commerce',
      'Applied Position: Software Developer',
      'Education',
      'Bachelor of Science in Imaginary Computing',
      'University of Example, Colombo',
      '2019 - 2023',
    ],
  };

  for (const [name, lines] of Object.entries(SAMPLES)) {
    test(`${name}: the same PDF through the link route and the upload route`, async () => {
      const buffer = await buildPdf([
        ...lines,
        'Fictional padding line to make the test file long enough.',
      ]);
      linkDocument = buffer;
      const total = await count('candidates');

      const fromFile = await extractFile(buffer);
      const fromLink = await extractLink('https://cv.example.test/sample.pdf');

      assert.equal(fromFile.status, 200, JSON.stringify(fromFile.body));
      assert.equal(fromLink.status, 200, JSON.stringify(fromLink.body));
      assert.deepEqual(fromLink.body.extraction, fromFile.body.extraction);
      assert.deepEqual(fromLink.body.duplicates, fromFile.body.duplicates);
      // Only the link route reports a link, and neither route saves anything.
      assert.equal(fromFile.body.cvUrl, null);
      assert.equal(fromLink.body.cvUrl, 'https://cv.example.test/sample.pdf');
      assert.equal(await count('candidates'), total);
    });
  }

  test('a template CV read through a link leaves the placeholders empty', async () => {
    linkDocument = await buildPdf([
      ...TEMPLATE_CV,
      'Fictional padding line to make the test file long enough.',
    ]);
    const res = await extractLink('https://cv.example.test/template.pdf');
    const { formDraft } = res.body.extraction;
    assert.equal(formDraft.email, undefined);
    assert.equal(formDraft.phone, undefined);
    assert.equal(formDraft.fullName, undefined);
    assert.equal(formDraft.address, 'Santa Ana, CA 92703');
    assert.match(
      formDraft.otherEducation,
      /^Bachelor of Science, Computer Science, University of California, Irvine/,
    );
  });
});

describe('the LinkedIn profile through the routes', () => {
  const LINES = [
    'ANUSHA PERERA',
    'Phone: 0771234567',
    'Email: anusha.perera@example.test',
    'LinkedIn: https://www.linkedin.com/in/example-profile',
    'Fictional padding line to make the test file long enough.',
  ];

  test('an uploaded file and a pasted link both return it, and neither saves or sets a Source', async () => {
    const buffer = await buildPdf(LINES);
    linkDocument = buffer;
    const total = await count('candidates');

    const fromFile = await extractFile(buffer);
    const fromLink = await extractLink('https://cv.example.test/linkedin.pdf');

    for (const res of [fromFile, fromLink]) {
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.equal(
        res.body.extraction.formDraft.linkedinUrl,
        'https://www.linkedin.com/in/example-profile',
      );
      assert.equal(res.body.extraction.hints.source, null);
      assert.equal('sourceId' in res.body.extraction.formDraft, false);
    }
    assert.equal(await count('candidates'), total);
  });

  test('the save accepts the form with a LinkedIn value present but does not store it anywhere', async () => {
    // The candidate record has no LinkedIn column, so the form never sends it. If
    // something did send it, it is ignored rather than put in an unrelated column.
    const res = await register({
      fullName: 'Linkedin Sample',
      phone: '0700000099',
      linkedinUrl: 'https://www.linkedin.com/in/example-profile',
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const [row] = await h.query(
      'SELECT cv_url, company_cv_url, hr_comment, address FROM candidates WHERE id = $1',
      [res.body.candidate.id],
    );
    assert.deepEqual(row, { cv_url: null, company_cv_url: null, hr_comment: null, address: null });
    assert.equal(JSON.stringify(res.body).includes('linkedin.com'), false);
  });
});

describe('a form-style PDF through both routes', () => {
  test('an uploaded file and a pasted link give the same extraction', async () => {
    const buffer = await buildPositionedPdf(formTablePlacements());
    linkDocument = buffer;
    const total = await count('candidates');
    const fromFile = await extractFile(buffer);
    const fromLink = await extractLink('https://cv.example.test/form.pdf');
    assert.equal(fromFile.status, 200, JSON.stringify(fromFile.body));
    assert.deepEqual(fromLink.body.extraction, fromFile.body.extraction);
    assert.equal(fromFile.body.extraction.formDraft.fullName, 'Nimal Fernando');
    assert.equal(fromFile.body.extraction.hints.appliedPosition, 'UI/UX Designer');
    assert.equal(fromFile.body.extraction.hints.source, 'Referral');
    assert.equal(await count('candidates'), total);
  });
});
