// Tests for the contact details read from a CV: the email address (written in
// the text, behind a mailto: link, or lightly disguised) and up to two phone
// numbers. Every CV here is fictional and built in memory.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { extractCv } from '../src/modules/cv-extraction/extractCv.js';
import { buildDocx, buildPdf } from './helpers/fictionalCv.js';

const FILLER =
  'A short fictional profile written only so that the file has enough readable text to be opened.';

const fromDocx = async (lines, links) =>
  extractCv({ buffer: await buildDocx([...lines, FILLER], links) });
const fromPdf = async (lines, links) =>
  extractCv({ buffer: await buildPdf([...lines, FILLER], { links }) });
const fromHtml = (html) => extractCv({ buffer: Buffer.from(html), allowHtml: true });
const page = (body) =>
  `<!doctype html><html><body><h1>Nimali Testperson</h1>${body}<p>${FILLER.repeat(3)}</p></body></html>`;

describe('email', () => {
  test('an address written in the text is read', async () => {
    const result = await fromDocx(['Nimali Testperson', 'Email: nimali.testperson@example.test']);
    assert.equal(result.formDraft.email, 'nimali.testperson@example.test');
  });

  test('an address behind a mailto link in a PDF is read', async () => {
    const result = await fromPdf(['Nimali Testperson'], ['mailto:nimali.testperson@example.test']);
    assert.equal(result.formDraft.email, 'nimali.testperson@example.test');
  });

  test('an address behind a mailto link in a Word file is read', async () => {
    const result = await fromDocx(['Nimali Testperson'], ['mailto:nimali.testperson@example.test']);
    assert.equal(result.formDraft.email, 'nimali.testperson@example.test');
  });

  test('an address behind a mailto link in a web page is read, including entities', async () => {
    const result = await fromHtml(
      page('<a href="mailto:nimali.testperson&#64;example.test?subject=Hello">Write to me</a>'),
    );
    assert.equal(result.formDraft.email, 'nimali.testperson@example.test');
  });

  test('a disguised address is read', async () => {
    const result = await fromDocx([
      'Nimali Testperson',
      'Email: nimali.testperson [at] example [dot] test',
    ]);
    assert.equal(result.formDraft.email, 'nimali.testperson@example.test');
  });

  test('the labelled address comes first, the other is kept as an alternative', async () => {
    const result = await fromDocx([
      'Nimali Testperson',
      'Reference: boss@example.test',
      'Email: nimali.testperson@example.test',
    ]);
    assert.equal(result.formDraft.email, 'nimali.testperson@example.test');
    assert.deepEqual(result.fields.email.alternatives, ['boss@example.test']);
    assert.match(result.fields.email.note, /boss@example\.test/);
  });

  test('template addresses are rejected and nothing is invented', async () => {
    const result = await fromDocx(['Nimali Testperson', 'Email: your-name@email.com']);
    assert.equal(result.formDraft.email, undefined);
    assert.equal(result.fields.email.status, 'unavailable');
    const none = await fromDocx(['Nimali Testperson']);
    assert.equal(none.formDraft.email, undefined);
  });
});

describe('phone numbers', () => {
  test('one number fills Phone Number 1 only', async () => {
    const result = await fromDocx(['Nimali Testperson', 'Phone: 070 000 0001']);
    assert.equal(result.formDraft.phone, '0700000001');
    assert.equal(result.formDraft.phone2, undefined);
  });

  test('two different numbers fill both', async () => {
    const result = await fromDocx([
      'Nimali Testperson',
      'Phone: 070 000 0001',
      'Phone: 071 000 0002',
    ]);
    assert.equal(result.formDraft.phone, '0700000001');
    assert.equal(result.formDraft.phone2, '0710000002');
  });

  test('a labelled mobile number is Phone Number 1, whatever the order', async () => {
    const result = await fromDocx([
      'Nimali Testperson',
      'Home: 011 000 0003',
      'Mobile: 070 000 0001',
    ]);
    assert.equal(result.formDraft.phone, '0700000001');
    assert.equal(result.formDraft.phone2, '0110000003');
  });

  test('repeated copies of the same number are one number', async () => {
    const result = await fromDocx([
      'Nimali Testperson',
      'Phone: 070 000 0001',
      'Mobile: 070-000-0001',
      'Contact: +94 70 000 0001',
    ]);
    assert.equal(result.formDraft.phone, '0700000001');
    assert.equal(result.formDraft.phone2, undefined);
  });

  test('local and international numbers keep their + and leading zero', async () => {
    const result = await fromDocx([
      'Nimali Testperson',
      'Mobile: +94 70 000 0001',
      'Phone: 071 000 0002',
    ]);
    assert.equal(result.formDraft.phone, '+94700000001');
    assert.equal(result.formDraft.phone2, '0710000002');
  });

  test('a tel link in a web page is read', async () => {
    const result = await fromHtml(page('<a href="tel:+94700000001">Call me</a>'));
    assert.equal(result.formDraft.phone, '+94700000001');
  });

  test('dates, years and identity numbers are not phone numbers', async () => {
    const result = await fromDocx([
      'Nimali Testperson',
      'Date of birth: 12.03.2001',
      'NIC: 200112345678',
      'Education 2019 - 2022',
    ]);
    assert.equal(result.formDraft.phone, undefined);
    assert.equal(result.formDraft.phone2, undefined);
  });

  test('a third number is not offered', async () => {
    const result = await fromDocx([
      'Nimali Testperson',
      'Phone: 070 000 0001',
      'Phone: 071 000 0002',
      'Phone: 072 000 0003',
    ]);
    assert.equal(result.formDraft.phone, '0700000001');
    assert.equal(result.formDraft.phone2, '0710000002');
    assert.equal(Object.values(result.formDraft).includes('0720000003'), false);
  });
});

describe('email in awkward layouts', () => {
  const ADDRESS = 'nimali.testperson@example.test';
  const LAYOUTS = {
    'with no space after the label': ['Email:nimali.testperson@example.test'],
    'run into the next word': ['nimali.testperson@example.testPhone: 070 000 0001'],
    'with spaces around the @': ['Email: nimali.testperson @ example.test'],
    'split after the @': ['Email: nimali.testperson@', 'example.test'],
    'split before the @': ['Email: nimali.testperson', '@example.test'],
    'split after the dot': ['Email: nimali.testperson@example.', 'test'],
  };

  for (const [name, lines] of Object.entries(LAYOUTS)) {
    test(`an address ${name} is read from a PDF and a Word file`, async () => {
      for (const read of [fromDocx, fromPdf]) {
        const result = await read(['Nimali Testperson', ...lines]);
        assert.equal(result.formDraft.email, ADDRESS, name);
      }
    });
  }

  test('a handle on its own line is not made into an address', async () => {
    const result = await fromDocx(['John Smith', '@john.smith', 'Colombo']);
    assert.equal(result.formDraft.email, undefined);
  });

  test('a referee address is never used for the candidate', async () => {
    const lines = [
      'Nimali Testperson',
      `Email: ${ADDRESS}`,
      'References',
      'Mr Silva',
      'silva@acme-corp.org',
    ];
    const result = await fromDocx(lines);
    assert.equal(result.formDraft.email, ADDRESS);
    const only = await fromDocx([
      'Nimali Testperson',
      'References',
      'Mr Silva',
      'silva@acme-corp.org',
    ]);
    assert.equal(only.formDraft.email, undefined);
    assert.match(only.fields.email.note, /referee/);
  });

  test('two unlabelled addresses are not guessed between', async () => {
    const result = await fromDocx(['Nimali Testperson', ADDRESS, 'work@acme-corp.org']);
    assert.equal(result.formDraft.email, undefined);
    assert.equal(result.fields.email.status, 'uncertain');
    assert.deepEqual(result.fields.email.alternatives, [ADDRESS, 'work@acme-corp.org']);
  });

  test('with two addresses, the one labelled Email is used and the other is mentioned', async () => {
    const result = await fromDocx([
      'Nimali Testperson',
      `Email: ${ADDRESS}`,
      'Skype: other@acme-corp.org',
    ]);
    assert.equal(result.formDraft.email, ADDRESS);
    assert.match(result.fields.email.note, /other@acme-corp.org/);
  });
});

describe('email in web pages', () => {
  const ADDRESS = 'nimali.testperson@example.test';
  // Cloudflare's address protection: hex of the key byte, then each character XOR the key.
  const protectedHex = (address, key = 0x5a) =>
    [key, ...Buffer.from(address).map((byte) => byte ^ key)]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');

  test('an @ inside formatting tags does not split the address', async () => {
    const result = await fromHtml(
      page('<p>Email: nimali.testperson<span>@</span>example.test</p>'),
    );
    assert.equal(result.formDraft.email, ADDRESS);
  });

  test('an address behind a mailto link with only an icon inside is read', async () => {
    const result = await fromHtml(page(`<a href="mailto:${ADDRESS}"><i class="icon"></i></a>`));
    assert.equal(result.formDraft.email, ADDRESS);
  });

  test('an address hidden by Cloudflare is decoded without running anything', async () => {
    const tag = `<a class="__cf_email__" data-cfemail="${protectedHex(ADDRESS)}">[email&#160;protected]</a>`;
    const result = await fromHtml(page(`<p>Email: ${tag}</p>`));
    assert.equal(result.formDraft.email, ADDRESS);
  });

  test('an address a script would build is explained, not invented', async () => {
    const result = await fromHtml(
      page('<p>Email: <a class="__cf_email__" data-cfemail="zz">[email&#160;protected]</a></p>'),
    );
    assert.equal(result.formDraft.email, undefined);
    assert.ok(result.warnings.some((w) => /hides its email address/.test(w)));
  });

  test('a normal page gets no hidden-address warning', async () => {
    const result = await fromHtml(page(`<p>Email: ${ADDRESS}</p>`));
    assert.equal(result.formDraft.email, ADDRESS);
    assert.equal(
      result.warnings.some((w) => /hides its email/.test(w)),
      false,
    );
  });

  test('a link without an address does not stop the page being read', async () => {
    const result = await fromHtml(page(`<a name="top"></a><p>Email: ${ADDRESS}</p>`));
    assert.equal(result.formDraft.email, ADDRESS);
  });
});
