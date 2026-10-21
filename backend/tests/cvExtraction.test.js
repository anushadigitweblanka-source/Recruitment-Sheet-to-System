// Database-independent tests for Phase 1 CV extraction. Every CV is fictional
// and built in memory; nothing touches a database, the disk or the network.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { extractCv, EXTRACTABLE_FIELDS } from '../src/modules/cv-extraction/extractCv.js';
import { extractCvText, cleanText, MAX_BYTES } from '../src/modules/cv-extraction/textExtractor.js';
import { AMBIGUOUS_CV, FULL_CV, SPARSE_CV, buildDocx, buildPdf } from './helpers/fictionalCv.js';

const EXPECTED_FULL = {
  fullName: 'Nimali Testperson',
  phone: '0700000001',
  email: 'nimali.testperson@example.test',
  address: '12 Fictional Lane, Examplepura, Testland',
  olMaths: 'A',
  alResult: '2 Credits and 1 Pass',
  alStream: 'Physical Science',
};

for (const [label, build] of [
  ['PDF', () => buildPdf(FULL_CV)],
  ['DOCX', () => buildDocx(FULL_CV)],
]) {
  test(`${label}: a complete fictional CV fills every field`, async () => {
    const result = await extractCv({ buffer: await build() });

    assert.equal(result.status, 'extracted');
    assert.equal(result.source.format, label.toLowerCase());
    assert.deepEqual(result.review.unavailable, []);
    assert.deepEqual(result.review.uncertain, []);
    for (const [name, value] of Object.entries(EXPECTED_FULL)) {
      assert.equal(result.formDraft[name], value, name);
      assert.equal(result.fields[name].status, 'extracted', name);
    }
    assert.match(result.formDraft.otherEducation, /BSc in Imaginary Computing/);
    assert.match(result.formDraft.otherEducation, /Diploma in Dummy Web Design/);
    // The O/L and A/L lines are not repeated as "other education".
    assert.doesNotMatch(result.formDraft.otherEducation, /Ordinary|Advanced/);
  });
}

test('phone is kept as text with its leading 0', async () => {
  const result = await extractCv({ buffer: await buildDocx(FULL_CV) });
  assert.equal(typeof result.formDraft.phone, 'string');
  assert.equal(result.formDraft.phone.startsWith('0'), true);
  // Tidied by the candidate rules (spaces removed); the original is kept.
  assert.equal(result.fields.phone.original, '070 000 0001');
});

test('skills and experience are named but never copied into any field', async () => {
  const result = await extractCv({ buffer: await buildPdf(FULL_CV) });
  assert.deepEqual(result.unmappedSections.sort(), ['experience', 'skills']);
  const everything = JSON.stringify(result.fields) + JSON.stringify(result.formDraft);
  assert.doesNotMatch(everything, /Pretend programming|Fictional Works/);
});

test('missing information is reported, not invented', async () => {
  const result = await extractCv({ buffer: await buildDocx(SPARSE_CV) });

  assert.equal(result.status, 'partial');
  assert.equal(result.formDraft.email, 'kasun.dummyman@example.test');
  // The name has no label, so it is offered for review but not pre-filled.
  assert.equal(result.fields.fullName.status, 'uncertain');
  assert.equal(result.fields.fullName.value, 'Kasun Dummyman');
  assert.equal(result.formDraft.fullName, undefined);
  for (const name of ['phone', 'address', 'olMaths', 'alResult', 'alStream', 'otherEducation']) {
    assert.equal(result.fields[name].status, 'unavailable', name);
    assert.equal(result.fields[name].value, null, name);
    assert.equal(result.formDraft[name], undefined, name);
  }
  assert.ok(result.warnings.some((w) => /Education/.test(w)));
});

test('several phones and emails are flagged as uncertain with the alternatives', async () => {
  const result = await extractCv({ buffer: await buildPdf(AMBIGUOUS_CV) });

  assert.equal(result.fields.phone.status, 'uncertain');
  assert.equal(result.fields.phone.alternatives.length, 2);
  assert.equal(result.fields.email.status, 'uncertain');
  assert.deepEqual(result.fields.email.alternatives, [
    'sam.one@example.test',
    'sam.two@example.test',
  ]);
  // A year range is not mistaken for a phone number.
  assert.ok(!result.fields.phone.alternatives.some((p) => p.includes('2019')));
  assert.equal(result.formDraft.phone, undefined);
  assert.equal(result.formDraft.email, undefined);
});

test('a number outside the phone rule is not offered as a phone', async () => {
  const result = await extractCv({
    buffer: await buildDocx(['Name: Short Number', 'Phone: 12345678901234567', 'a@example.test']),
  });
  // 17 digits is outside the form's 9-15 digit phone rule, so it is not even
  // offered as a phone number.
  assert.equal(result.fields.phone.status, 'unavailable');
});

test('the draft never carries a Candidate ID or other fields extraction does not own', async () => {
  const result = await extractCv({ buffer: await buildPdf(FULL_CV) });
  assert.deepEqual(Object.keys(result.formDraft).sort(), EXTRACTABLE_FIELDS.slice().sort());
  for (const name of ['candidateCode', 'positionId', 'sourceId', 'cvUrl', 'hrComment']) {
    assert.equal(name in result.formDraft, false, name);
    assert.ok(result.notExtracted[name], name);
  }
});

test('extraction is deterministic: the same file gives the same result', async () => {
  const buffer = await buildDocx(FULL_CV);
  assert.deepEqual(await extractCv({ buffer }), await extractCv({ buffer }));
});

test('unsupported and unreadable files fail with a clear reason', async () => {
  const cases = [
    [Buffer.alloc(0), 'no_file'],
    [Buffer.from('just some plain text, not a CV file'), 'unsupported_format'],
    [Buffer.from('d0cf11e0a1b11ae1', 'hex'), 'legacy_doc'],
    [Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.from('garbage')]), 'unreadable'],
    [Buffer.from('PK\u0003\u0004 not really a zip'), 'unreadable'],
    [Buffer.alloc(MAX_BYTES + 1, 1), 'too_large'],
  ];
  for (const [buffer, reason] of cases) {
    const result = await extractCv({ buffer });
    assert.equal(result.status, 'failed', reason);
    assert.equal(result.reason, reason);
    assert.ok(result.message);
    assert.deepEqual(result.formDraft, {});
  }
});

test('a zip that is not a Word document is refused', async () => {
  const zip = new JSZip();
  zip.file('readme.txt', 'not a word document');
  const result = await extractCv({ buffer: await zip.generateAsync({ type: 'nodebuffer' }) });
  assert.equal(result.reason, 'unsupported_format');
});

test('a PDF or Word file with no text is reported, since OCR is not used', async () => {
  for (const buffer of [await buildPdf(['']), await buildDocx([''])]) {
    const result = await extractCv({ buffer });
    assert.equal(result.reason, 'no_text');
    assert.match(result.message, /readable text/);
  }
});

test('a long PDF is read only up to the page limit', async () => {
  const read = await extractCvText({ buffer: await buildPdf(FULL_CV, { pages: 12 }) });
  assert.equal(read.ok, true);
  assert.equal(read.pageCount, 12);
  assert.ok(read.warnings.some((w) => /first 10 of 12 pages/.test(w)));
});

test('cleanText removes invisible characters and unifies line endings', () => {
  assert.equal(cleanText('a\u00a0b\r\nc\u200b\r\n\r\n\r\n\r\nd  \n'), 'a b\nc\n\nd');
});

test('no network call is made while extracting', async (t) => {
  const original = globalThis.fetch;
  globalThis.fetch = () => {
    throw new Error('network access attempted');
  };
  t.after(() => {
    globalThis.fetch = original;
  });
  const result = await extractCv({ buffer: await buildPdf(FULL_CV) });
  assert.equal(result.status, 'extracted');
});

test('a differently worded fictional CV is read too', async () => {
  const lines = [
    'RESUME',
    'Full Name: Ravi Samplestudent',
    'Mobile No: +94 70 000 0004',
    'E-mail: ravi@example.test',
    'Permanent Address:',
    '5 Imaginary Road',
    'Samplecity',
    'Email me anytime',
    'Educational Qualifications',
    'O/L - Maths B',
    'A/L (Commerce stream) Results: ABC',
    'NVQ Level 4 in Pretend Accounting',
  ];
  const result = await extractCv({ buffer: await buildDocx(lines) });

  assert.equal(result.formDraft.fullName, 'Ravi Samplestudent');
  assert.equal(result.formDraft.phone, '+94700000004');
  assert.equal(result.formDraft.olMaths, 'B');
  assert.equal(result.formDraft.alStream, 'Commerce');
  assert.equal(result.formDraft.alResult, 'ABC');
  assert.equal(result.formDraft.otherEducation, 'NVQ Level 4 in Pretend Accounting');
  assert.match(result.formDraft.address, /^5 Imaginary Road, Samplecity/);
});
