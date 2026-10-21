// LinkedIn profile detection. Fictional CVs only. Nothing here fetches anything:
// the address is only ever read and checked for shape.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { extractCv } from '../src/modules/cv-extraction/extractCv.js';
import { canonicalLinkedinProfile } from '../src/modules/cv-extraction/linkedin.js';
import { FULL_CV, buildDocx, buildPdf } from './helpers/fictionalCv.js';

const PAD = 'Fictional padding line to make the test file long enough.';
const HEAD = ['ANUSHA PERERA', 'Phone: 0771234567', 'Email: anusha.perera@example.test'];
const PROFILE = 'https://www.linkedin.com/in/example-profile';

async function both(lines, links = []) {
  const all = [...lines, PAD];
  return [
    await extractCv({ buffer: await buildDocx(all, links) }),
    await extractCv({ buffer: await buildPdf(all, { links }) }),
  ];
}

describe('what counts as a candidate LinkedIn profile address', () => {
  test('personal profiles, written in the ways CVs write them', () => {
    for (const written of [
      'https://www.linkedin.com/in/example-profile',
      'https://linkedin.com/in/example-profile',
      'http://www.linkedin.com/in/example-profile',
      'www.linkedin.com/in/example-profile',
      'linkedin.com/in/example-profile',
      'LinkedIn.com/in/Example-Profile',
      'https://www.linkedin.com/in/example-profile/',
      'https://www.linkedin.com/in/example-profile?utm_source=share',
      'https://www.linkedin.com/in/example-profile#about',
      'https://www.linkedin.com/in/example-profile.',
      '(https://www.linkedin.com/in/example-profile)',
      'https://uk.linkedin.com/in/example-profile',
    ]) {
      const cleaned = written.replace(/^\(|\)$/g, '');
      assert.match(
        canonicalLinkedinProfile(cleaned) ?? '',
        /^https:\/\/www\.linkedin\.com\/in\/example-profile$/i,
        written,
      );
    }
  });

  test('a company, school, job or post page is not a candidate profile', () => {
    for (const written of [
      'https://www.linkedin.com/company/example-ltd',
      'https://www.linkedin.com/school/example-university/',
      'https://www.linkedin.com/jobs/view/123456',
      'https://www.linkedin.com/posts/example_post-123',
      'https://www.linkedin.com/feed/',
      'https://www.linkedin.com/in/',
      'https://www.linkedin.com/',
    ]) {
      assert.equal(canonicalLinkedinProfile(written), null, written);
    }
  });

  test('addresses on other sites, look-alikes and unsafe forms are refused', () => {
    for (const written of [
      'https://linkedin.com.example.test/in/example-profile',
      'https://notlinkedin.com/in/example-profile',
      'https://example.test/linkedin.com/in/example-profile',
      'https://user:pass@www.linkedin.com/in/example-profile',
      'javascript:alert(1)//linkedin.com/in/example-profile',
      'ftp://www.linkedin.com/in/example-profile',
      'https://www.linkedin.com/in/bad slug',
      'https://www.linkedin.com/in/<script>',
      '',
      null,
    ]) {
      assert.equal(canonicalLinkedinProfile(written), null, String(written));
    }
  });

  test('template placeholders are not profiles', () => {
    for (const slug of [
      'your-name',
      'yourname',
      'your-profile',
      'username',
      'firstname-lastname',
      'first-last',
    ]) {
      assert.equal(canonicalLinkedinProfile(`https://www.linkedin.com/in/${slug}`), null, slug);
    }
  });
});

describe('finding the profile in a CV', () => {
  test('written out in the text (Word and PDF)', async () => {
    for (const lines of [
      [...HEAD, `LinkedIn: ${PROFILE}`],
      [...HEAD, PROFILE],
      [...HEAD, 'linkedin.com/in/example-profile'],
      [...HEAD, `Profile - www.linkedin.com/in/example-profile | Phone: 0771234567`],
    ]) {
      for (const result of await both(lines)) {
        assert.equal(result.formDraft.linkedinUrl, PROFILE, lines.at(-1));
        assert.equal(result.fields.linkedinUrl.status, 'extracted');
        assert.ok(result.review.extracted.includes('linkedinUrl'));
      }
    }
  });

  test('behind a clickable word such as "LinkedIn" (a PDF link or a Word hyperlink)', async () => {
    for (const result of await both([...HEAD, 'Links: see below'], [PROFILE])) {
      assert.equal(result.formDraft.linkedinUrl, PROFILE);
    }
  });

  test('the same profile as text and as a link is one profile, not a conflict', async () => {
    for (const result of await both([...HEAD, `LinkedIn: ${PROFILE}`], [PROFILE])) {
      assert.equal(result.formDraft.linkedinUrl, PROFILE);
      assert.equal(result.fields.linkedinUrl.status, 'extracted');
    }
  });

  test('a CV without one leaves the field empty and invents nothing', async () => {
    for (const result of await both(HEAD)) {
      assert.equal(result.fields.linkedinUrl.status, 'unavailable');
      assert.equal(result.fields.linkedinUrl.value, null);
      assert.equal('linkedinUrl' in result.formDraft, false);
      assert.ok(!result.review.extracted.includes('linkedinUrl'));
    }
  });

  test('a company LinkedIn page alone is not taken for the candidate', async () => {
    for (const result of await both([
      ...HEAD,
      'Company page: https://www.linkedin.com/company/example-ltd',
    ])) {
      assert.equal('linkedinUrl' in result.formDraft, false);
      assert.match(result.fields.linkedinUrl.note, /company/i);
    }
  });

  test('a company page next to a profile: the profile is chosen', async () => {
    const lines = [
      ...HEAD,
      'Worked at https://www.linkedin.com/company/example-ltd',
      `LinkedIn: ${PROFILE}`,
    ];
    for (const result of await both(lines)) assert.equal(result.formDraft.linkedinUrl, PROFILE);
  });

  test('two different profiles are left for HR', async () => {
    const lines = [
      ...HEAD,
      `LinkedIn: ${PROFILE}`,
      'Portfolio: https://www.linkedin.com/in/other-person',
    ];
    for (const result of await both(lines)) {
      assert.equal(result.fields.linkedinUrl.status, 'uncertain');
      assert.equal(result.fields.linkedinUrl.value, null);
      assert.equal(result.fields.linkedinUrl.alternatives.length, 2);
      assert.equal('linkedinUrl' in result.formDraft, false);
      assert.ok(result.review.uncertain.includes('linkedinUrl'));
    }
  });

  test('a referee’s profile under References is not the candidate’s', async () => {
    const lines = [
      ...HEAD,
      'References',
      'Mr. Saman Referee',
      'https://www.linkedin.com/in/saman-referee',
    ];
    for (const result of await both(lines)) {
      assert.equal('linkedinUrl' in result.formDraft, false);
    }
  });

  test('a placeholder profile in a template is ignored', async () => {
    for (const result of await both([...HEAD, 'LinkedIn: https://www.linkedin.com/in/your-name'])) {
      assert.equal('linkedinUrl' in result.formDraft, false);
    }
  });
});

describe('nothing else changes', () => {
  test('a LinkedIn profile does not set the Source or any position', async () => {
    for (const result of await both([...HEAD, `LinkedIn: ${PROFILE}`])) {
      assert.equal(result.hints.source, null);
      assert.equal('sourceId' in result.formDraft, false);
      assert.equal(result.hints.appliedPosition, null);
    }
  });

  test('"Source: LinkedIn" still reports the source, apart from the link', async () => {
    for (const result of await both([...HEAD, 'Source: LinkedIn', `LinkedIn: ${PROFILE}`])) {
      assert.equal(result.hints.source, 'LinkedIn');
      assert.equal(result.formDraft.linkedinUrl, PROFILE);
    }
  });

  test('the address, name, phone and email are unaffected by a LinkedIn line', async () => {
    const lines = [
      ...HEAD,
      'Address: 123 Example Road, Colombo, Sri Lanka',
      `LinkedIn: ${PROFILE}`,
    ];
    for (const result of await both(lines)) {
      assert.equal(result.formDraft.address, '123 Example Road, Colombo, Sri Lanka');
      assert.equal(result.formDraft.fullName, 'ANUSHA PERERA');
      assert.equal(result.formDraft.phone, '0771234567');
      assert.equal(result.formDraft.email, 'anusha.perera@example.test');
    }
  });

  test('an optional LinkedIn link does not make a complete CV look incomplete', async () => {
    const complete = await extractCv({ buffer: await buildDocx([...FULL_CV]) });
    assert.equal(complete.status, 'extracted');
    assert.deepEqual(complete.review.unavailable, []);
  });

  test('the link must not be requested: no network is used while reading', async (t) => {
    const original = globalThis.fetch;
    globalThis.fetch = () => {
      throw new Error('network access attempted');
    };
    t.after(() => {
      globalThis.fetch = original;
    });
    const [word, pdf] = await both([...HEAD, `LinkedIn: ${PROFILE}`]);
    assert.equal(word.formDraft.linkedinUrl, PROFILE);
    assert.equal(pdf.formDraft.linkedinUrl, PROFILE);
  });
});
