// Database-independent tests for Phase 1 CV extraction. Every CV is fictional
// and built in memory; nothing touches a database, the disk or the network.

import { describe, test } from 'node:test';
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
  // The name has no label but is clearly the CV's first line, so it is filled in.
  assert.equal(result.fields.fullName.status, 'extracted');
  assert.equal(result.fields.fullName.note, null);
  assert.equal(result.formDraft.fullName, 'Kasun Dummyman');
  for (const name of ['phone', 'address', 'olMaths', 'alResult', 'alStream', 'otherEducation']) {
    assert.equal(result.fields[name].status, 'unavailable', name);
    assert.equal(result.fields[name].value, null, name);
    assert.equal(result.formDraft[name], undefined, name);
  }
  assert.ok(result.warnings.some((w) => /Education/.test(w)));
});

test('two phones fill both numbers, but several emails are left for HR to choose', async () => {
  const result = await extractCv({ buffer: await buildPdf(AMBIGUOUS_CV) });

  assert.equal(result.fields.phone.status, 'extracted');
  assert.equal(result.fields.phone.alternatives.length, 1);
  assert.equal(result.formDraft.phone, result.fields.phone.value);
  assert.equal(result.formDraft.phone2, result.fields.phone.alternatives[0].replace(/[\s-]/g, ''));
  assert.equal(result.fields.email.status, 'uncertain');
  assert.equal(result.formDraft.email, undefined);
  assert.deepEqual(result.fields.email.alternatives, [
    'sam.one@example.test',
    'sam.two@example.test',
  ]);
  // A year range is not mistaken for a phone number.
  assert.ok(![result.formDraft.phone, result.formDraft.phone2].some((p) => p.includes('2019')));
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

// ---------------------------------------------------------------------------
// Names and phones that carry no label, and the dropdown hints.

// A short closing line keeps tiny test CVs above the minimum amount of text.
const PADDING = 'Fictional padding line to make the test file long enough.';
const read = async (lines) => extractCv({ buffer: await buildDocx([...lines, PADDING]) });

describe('name detection', () => {
  const NAMES = [
    ['an uppercase name', 'ANUSHA PERERA', 'ANUSHA PERERA'],
    ['a lowercase name', 'anusha perera', 'anusha perera'],
    ['a mixed-case name', 'Anusha Perera', 'Anusha Perera'],
    ['a name with initials', 'A. B. Perera', 'A. B. Perera'],
    ['a name with a title', 'Mr. Kasun Fernando', 'Mr. Kasun Fernando'],
  ];
  for (const [label, line, expected] of NAMES) {
    test(`${label} on the first line is filled in exactly as written, without a note`, async () => {
      for (const buffer of [
        await buildDocx([line, 'Phone: 0771234567', 'Email: a@example.test']),
        await buildPdf([line, 'Phone: 0771234567', 'Email: a@example.test']),
      ]) {
        const result = await extractCv({ buffer });
        assert.equal(result.formDraft.fullName, expected);
        assert.equal(result.fields.fullName.status, 'extracted');
        assert.equal(result.fields.fullName.note, null);
        assert.deepEqual(result.review.uncertain, []);
      }
    });
  }

  test('a name after a Curriculum Vitae heading is found', async () => {
    const result = await read(['CURRICULUM VITAE', 'Nimal Jayasuriya', '0771234567']);
    assert.equal(result.formDraft.fullName, 'Nimal Jayasuriya');
  });

  test('a name in a header line with other details is found', async () => {
    const result = await read(['ANUSHA PERERA | 0771234567 | anusha@example.test']);
    assert.equal(result.formDraft.fullName, 'ANUSHA PERERA');
    assert.equal(result.formDraft.phone, '0771234567');
    assert.equal(result.formDraft.email, 'anusha@example.test');
  });

  test('a name in a Personal Details section is found', async () => {
    const result = await read([
      'Objective',
      'To work with a good team.',
      'Personal Details',
      'Dilani Rathnayake',
      'Mobile: 0771234567',
    ]);
    assert.equal(result.formDraft.fullName, 'Dilani Rathnayake');
  });

  test('a job title below the name is not mistaken for the name', async () => {
    const result = await read(['ANUSHA PERERA', 'Software Developer', '0771234567']);
    assert.equal(result.formDraft.fullName, 'ANUSHA PERERA');
  });

  test('headings, job titles, universities and companies are never names', async () => {
    for (const line of [
      'Curriculum Vitae',
      'Resume',
      'Personal Profile',
      'Software Developer',
      'Senior Web Designer',
      'University of Example',
      'Fictional Institute of Technology',
      'Example Solutions Pvt Ltd',
      'Looking for an internship',
    ]) {
      const result = await read([line, 'Phone: 0771234567', 'Email: a@example.test']);
      assert.equal(result.fields.fullName.value, null, line);
      assert.equal(result.formDraft.fullName, undefined, line);
      assert.equal(result.fields.fullName.status, 'unavailable', line);
    }
  });

  test('a referee named under References is not the candidate', async () => {
    const result = await read([
      'Name: Anusha Perera',
      'Phone: 0771234567',
      'References',
      'Name: Saman Referee',
      'Phone: 0112345678',
    ]);
    assert.equal(result.formDraft.fullName, 'Anusha Perera');
    assert.equal(result.formDraft.phone, '0771234567');
  });

  test('two different labelled names are a conflict: nothing is chosen', async () => {
    const result = await read(['Name: Anusha Perera', 'Name: Kamal Silva', 'Phone: 0771234567']);
    assert.equal(result.fields.fullName.status, 'uncertain');
    assert.equal(result.fields.fullName.value, null);
    assert.deepEqual(result.fields.fullName.alternatives, ['Anusha Perera', 'Kamal Silva']);
    assert.equal(result.formDraft.fullName, undefined);
  });

  test('a lowercase sentence is not taken as a name', async () => {
    const result = await read(['i am a motivated student', 'Phone: 0771234567']);
    assert.equal(result.fields.fullName.value, null);
  });
});

describe('phone detection', () => {
  const draftPhone = async (lines) => (await read(lines)).formDraft.phone;

  test('an unlabelled local number keeps its leading zero, as text', async () => {
    const phone = await draftPhone(['ANUSHA PERERA', '0771234567', 'anusha@example.test']);
    assert.equal(phone, '0771234567');
    assert.equal(typeof phone, 'string');
  });

  test('an unlabelled international number keeps its +', async () => {
    assert.equal(
      await draftPhone(['ANUSHA PERERA', '+94771234567', 'anusha@example.test']),
      '+94771234567',
    );
    assert.equal(
      await draftPhone(['ANUSHA PERERA', '+94 77 123 4567', 'anusha@example.test']),
      '+94771234567',
    );
  });

  test('a number in a header line or contact section is found without a label', async () => {
    assert.equal(await draftPhone(['ANUSHA PERERA | 077 123 4567 | a@example.test']), '0771234567');
    assert.equal(
      await draftPhone(['ANUSHA PERERA', 'Contact Details', '077-123-4567', 'a@example.test']),
      '0771234567',
    );
  });

  test('labelled numbers still work, and the number is not fabricated or shortened', async () => {
    for (const label of ['Phone', 'Mobile', 'Tel', 'Contact No', 'Mobile No']) {
      assert.equal(await draftPhone([`${label}: 0771234567`]), '0771234567', label);
    }
    // Eight digits are too few to be a phone number: nothing is made up.
    assert.equal(await draftPhone(['Phone: 12345678']), undefined);
  });

  test('the mobile number is the main one when a landline is also given', async () => {
    const result = await read(['Tel: 0112345678', 'Mobile: 0771234567']);
    assert.equal(result.formDraft.phone, '0771234567');
    assert.equal(result.fields.phone.status, 'extracted');
  });

  test('a mobile-shaped number beats an unlabelled landline', async () => {
    const result = await read(['0112345678', '0771234567']);
    assert.equal(result.formDraft.phone, '0771234567');
  });

  test('dates, years, ID numbers, postal codes and fax numbers are not phones', async () => {
    for (const line of [
      'Date of birth: 12.03.2001',
      'Studied 2019 - 2022',
      'NIC: 200112345678',
      'NIC: 123456789V',
      'Postal code: 10100',
      'Fax: 0112345678',
      'Candidate ID: 2110202601',
      '2110202601',
      '200112345678',
    ]) {
      assert.equal(await draftPhone([line]), undefined, line);
    }
  });

  test('a referee number under References is not the candidate phone', async () => {
    const result = await read(['ANUSHA PERERA', 'References', 'Mr. Saman Referee', '0112345678']);
    assert.equal(result.fields.phone.status, 'unavailable');
  });

  test('two numbers fill Phone Number 1 and Phone Number 2, in reading order', async () => {
    const result = await read(['ANUSHA PERERA', '0771234567', '0712345678']);
    assert.equal(result.fields.phone.status, 'extracted');
    assert.equal(result.formDraft.phone, '0771234567');
    assert.equal(result.formDraft.phone2, '0712345678');
    assert.deepEqual(result.fields.phone.alternatives, ['0712345678']);
  });

  test('the same number written two ways is one number', async () => {
    const result = await read(['Mobile: 0771234567', 'Contact: +94 77 123 4567']);
    assert.equal(result.fields.phone.status, 'extracted');
  });
});

describe('Applied Position and Source hints', () => {
  test('a stated applied position and source are reported as text, nothing is guessed', async () => {
    const result = await read([
      'Name: Anusha Perera',
      'Applied Position: QA Intern',
      'Source: LinkedIn',
    ]);
    assert.deepEqual(result.hints, {
      appliedPosition: 'QA Intern',
      targetPosition: null,
      source: 'LinkedIn',
    });
  });

  test('no hint is produced from general experience or generic content', async () => {
    const result = await read([
      'Name: Anusha Perera',
      'Experience',
      'Position: Web Developer at Example Ltd',
      'I found this job on LinkedIn and through a referral.',
    ]);
    assert.deepEqual(result.hints, { appliedPosition: null, targetPosition: null, source: null });
  });

  test('other phrasings of the applied position are understood', async () => {
    for (const line of [
      'Position applied for: QA Intern',
      'Applying for: QA Intern',
      'Post Applied For - QA Intern',
    ]) {
      assert.equal((await read(['Name: Anusha Perera', line])).hints.appliedPosition, 'QA Intern');
    }
  });
});

describe('real PDF files', () => {
  test('an unlabelled name and phone in a PDF header are filled in, as text', async () => {
    const result = await extractCv({
      buffer: await buildPdf([
        'ANUSHA PERERA',
        '+94 77 123 4567',
        'anusha.perera@example.test',
        'Education',
        'BSc in Imaginary Computing, Fictional University',
      ]),
    });
    assert.equal(result.formDraft.fullName, 'ANUSHA PERERA');
    assert.equal(result.formDraft.phone, '+94771234567');
    assert.equal(typeof result.formDraft.phone, 'string');
    assert.deepEqual(result.review.uncertain, []);
    assert.equal(result.fields.phone.note, null);
  });
});
