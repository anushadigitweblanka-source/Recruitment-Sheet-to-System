// Tests for reading a CV from any kind of link: a PDF or Word file, a plain web
// page, a page with its details in structured data, a page that links to a CV
// document, a page that builds itself with JavaScript, and links that must be
// refused. Nothing here is specific to one website: every address, person and
// page is fictional, the network is a stub and the database is a throwaway
// in-memory Postgres.

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { findDocumentLinks, findPerson } from '../src/modules/cv-extraction/htmlText.js';
import { FetchRefused } from '../src/modules/cv-extraction/safeFetch.js';
import { readCvLink } from '../src/modules/cv-extraction/linkCv.js';
import {
  FULL_CV,
  buildDocx,
  buildPdf,
  buildPositionedPdf,
  twoColumnPlacements,
} from './helpers/fictionalCv.js';
import { startMemoryHarness } from './helpers/memoryDb.js';

const FILLER =
  'A short fictional profile written only so that the file has enough readable text to be opened.';
const html = (text) => Buffer.from(text, 'utf8');
const page = (body, head = '') =>
  `<!doctype html><html><head><title>CV</title>${head}</head><body>${body}</body></html>`;

const personJsonLd = (extra = {}) =>
  `<script type="application/ld+json">${JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Person',
    name: 'Nimali Testperson',
    email: 'nimali.testperson@example.test',
    telephone: ['+94 70 000 0001', '071 000 0002'],
    address: { '@type': 'PostalAddress', addressLocality: 'Examplepura', addressCountry: 'LK' },
    sameAs: ['https://www.linkedin.com/in/nimali-testperson/', 'https://github.com/nimali-test'],
    ...extra,
  })}</script>`;

// An empty application shell, as a JavaScript-built site serves it.
const SHELL = page('<div id="root"></div><script type="module" src="/app.js"></script>');

// What a browser would show once that shell has built itself.
const RENDERED_TEXT = [
  'Nimali Testperson',
  'Applied Position: Imaginary Web Developer',
  'Contact',
  'Mobile: 070 000 0001',
  'Phone: 071 000 0002',
  'Email: nimali.testperson@example.test',
  'Address: 12 Fictional Lane, Examplepura, Testland',
  'Education',
  'G.C.E. Ordinary Level (2018) - Fictional College',
  'Mathematics: A, Science: B, English: C',
  'G.C.E. Advanced Level (2021) - Fictional College',
  'Stream: Physical Science',
  'Results: 2 Credits and 1 Pass',
  'BSc in Imaginary Computing, Fictional University (2022 - 2026)',
].join('\n');

// A fake web: address -> bytes (or a FetchRefused to throw). Records each request.
function fakeWeb(sites) {
  const calls = [];
  const fetchDocument = async (url) => {
    calls.push(url);
    const hit = sites[url];
    if (hit instanceof Error) throw hit;
    if (!hit) throw new FetchRefused('unreachable', 'The link could not be opened.');
    return { buffer: hit };
  };
  fetchDocument.calls = calls;
  return fetchDocument;
}

const noRender = async () => {
  throw Object.assign(new Error('no browser'), { reason: 'no_browser' });
};

describe('finding the details a page declares', () => {
  test('a Person in structured data gives name, email, phones, address and profile links', () => {
    const person = findPerson(page('<p>x</p>', personJsonLd()));
    assert.equal(person.name, 'Nimali Testperson');
    assert.equal(person.email, 'nimali.testperson@example.test');
    assert.deepEqual(person.phones, ['+94 70 000 0001', '071 000 0002']);
    assert.equal(person.address, 'Examplepura, LK');
    assert.ok(person.sameAs.includes('https://www.linkedin.com/in/nimali-testperson/'));
  });

  test('a Person nested in a graph is found, and other types are ignored', () => {
    const graph = `<script type="application/ld+json">${JSON.stringify({
      '@graph': [
        { '@type': 'WebSite', name: 'Site' },
        { '@type': ['Person'], name: 'Kasun Dummyman' },
      ],
    })}</script>`;
    assert.equal(findPerson(page('', graph)).name, 'Kasun Dummyman');
    assert.equal(
      findPerson(page('', '<script type="application/ld+json">{"@type":"WebSite"}</script>')),
      null,
    );
  });

  test('broken or hostile structured data is ignored', () => {
    assert.equal(
      findPerson(page('', '<script type="application/ld+json">{not json</script>')),
      null,
    );
    const odd = personJsonLd({
      email: 'not an email',
      telephone: 'x'.repeat(100),
      sameAs: ['http://plain.example.test'],
    });
    const person = findPerson(page('', odd));
    assert.equal(person.email, '');
    assert.deepEqual(person.phones, []);
    assert.deepEqual(person.sameAs, []);
  });
});

describe('finding a CV document a page links to', () => {
  const BASE = 'https://site.example.test/me/';
  const find = (body, head = '') => findDocumentLinks(page(body, head), BASE);

  test('links to PDF and Word files are found, resolved and made absolute', () => {
    const links = find('<a href="cv.pdf">x</a> <a href="/files/me.docx">y</a>');
    assert.deepEqual(links.sort(), [
      'https://site.example.test/files/me.docx',
      'https://site.example.test/me/cv.pdf',
    ]);
  });

  test('a link worded CV or Resume is found even when its address has no extension', () => {
    assert.deepEqual(find('<a href="/download?id=7">Download my CV</a>'), [
      'https://site.example.test/download?id=7',
    ]);
  });

  test('a preloaded document in the page head is found', () => {
    assert.deepEqual(find('', '<link rel="preload" href="/My%20File.pdf" as="document">'), [
      'https://site.example.test/My%20File.pdf',
    ]);
  });

  test('unrelated links, other schemes, plain http and the page itself are not offered', () => {
    const links = find(
      [
        '<a href="/about">About</a>',
        '<a href="http://other.example.test/cv.pdf">CV</a>',
        '<a href="mailto:me@example.test">CV mail</a>',
        '<a href="javascript:void(0)">Resume</a>',
        '<a href="#cv">CV</a>',
        '<a href="/privacy.pdf">Privacy policy</a>',
      ].join(''),
    );
    assert.deepEqual(links, []);
  });

  test('nothing is offered without a base address', () => {
    assert.deepEqual(findDocumentLinks(page('<a href="cv.pdf">CV</a>'), null), []);
  });
});

describe('reading a link, by what comes back rather than by its address', () => {
  test('a PDF at an address with no extension and a query string is read as a PDF', async () => {
    const pdf = await buildPdf(FULL_CV);
    const fetchDocument = fakeWeb({ 'https://files.example.test/get?id=42&dl=1': pdf });
    const result = await readCvLink({
      url: 'https://files.example.test/get?id=42&dl=1',
      fetchDocument,
    });
    assert.equal(result.source.format, 'pdf');
    assert.equal(result.formDraft.fullName, 'Nimali Testperson');
  });

  test('a Word file is read as a Word file', async () => {
    const fetchDocument = fakeWeb({ 'https://files.example.test/cv': await buildDocx(FULL_CV) });
    const result = await readCvLink({ url: 'https://files.example.test/cv', fetchDocument });
    assert.equal(result.source.format, 'docx');
    assert.equal(result.formDraft.email, 'nimali.testperson@example.test');
  });

  test('a two-column CV is read column by column', async () => {
    const pdf = await buildPositionedPdf(twoColumnPlacements());
    const result = await readCvLink({
      url: 'https://files.example.test/two.pdf',
      fetchDocument: fakeWeb({ 'https://files.example.test/two.pdf': pdf }),
    });
    assert.equal(result.formDraft.email, 'anusha.perera@example.test');
    assert.equal(result.formDraft.phone, '0771234567');
  });

  test('a plain HTML CV page is read without any browser', async () => {
    const body = page(
      `<h1>Nimali Testperson</h1><p>${FILLER}</p>${RENDERED_TEXT.split('\n')
        .map((l) => `<p>${l}</p>`)
        .join('')}`,
    );
    let rendered = 0;
    const result = await readCvLink({
      url: 'https://cv.example.test/me',
      fetchDocument: fakeWeb({ 'https://cv.example.test/me': html(body) }),
      renderPage: async () => {
        rendered += 1;
        return { text: '', anchors: [], links: [] };
      },
    });
    assert.equal(rendered, 0);
    assert.equal(result.formDraft.phone, '0700000001');
    assert.equal(result.formDraft.phone2, '0710000002');
    assert.equal(result.formDraft.olMaths, 'A');
    assert.equal(result.hints.appliedPosition, 'Imaginary Web Developer');
  });

  test('a page with its details in structured data is read without a browser', async () => {
    let rendered = 0;
    const doc = page('<div id="root"></div>', personJsonLd());
    const result = await readCvLink({
      url: 'https://cv.example.test/',
      fetchDocument: fakeWeb({ 'https://cv.example.test/': html(doc) }),
      renderPage: async () => {
        rendered += 1;
        throw new Error('should not be needed');
      },
    });
    // A bare shell with a Person: the structured data states enough on its own, so
    // the browser is not needed.
    assert.equal(result.formDraft.fullName, 'Nimali Testperson');
    assert.equal(result.formDraft.email, 'nimali.testperson@example.test');
    assert.equal(result.formDraft.phone, '+94700000001');
    assert.equal(result.formDraft.phone2, '0710000002');
    assert.equal(result.formDraft.linkedinUrl, 'https://www.linkedin.com/in/nimali-testperson');
    assert.equal(rendered, 0);
  });

  test('a page that links to a CV document is read together with that document', async () => {
    const pdf = await buildPdf(FULL_CV);
    const doc = page(
      '<div id="root"></div><a href="/files/cv.pdf">Download CV</a>',
      personJsonLd(),
    );
    const fetchDocument = fakeWeb({
      'https://cv.example.test/': html(doc),
      'https://cv.example.test/files/cv.pdf': pdf,
    });
    const result = await readCvLink({
      url: 'https://cv.example.test/',
      fetchDocument,
      renderPage: noRender,
    });
    assert.equal(result.source.linkedDocument, true);
    assert.deepEqual(fetchDocument.calls, [
      'https://cv.example.test/',
      'https://cv.example.test/files/cv.pdf',
    ]);
    // From the document...
    assert.equal(result.formDraft.olMaths, 'A');
    assert.equal(result.formDraft.alStream, 'Physical Science');
    // ...and what only the page states (profile link).
    assert.equal(result.formDraft.linkedinUrl, 'https://www.linkedin.com/in/nimali-testperson');
  });

  test('a link that turns out to be another web page, or is refused, is skipped', async () => {
    const doc = page(
      `<div id="root"></div><a href="/a.pdf">CV</a><a href="/b.pdf">Resume</a>${personJsonLd()}`,
    );
    const result = await readCvLink({
      url: 'https://cv.example.test/',
      fetchDocument: fakeWeb({
        'https://cv.example.test/': html(doc),
        'https://cv.example.test/a.pdf': html('<!doctype html><html><body>Sign in</body></html>'),
        'https://cv.example.test/b.pdf': new FetchRefused(
          'needs_login',
          'The link needs a sign-in',
        ),
      }),
      renderPage: noRender,
    });
    assert.equal(result.source.linkedDocument, undefined);
    assert.equal(result.formDraft.fullName, 'Nimali Testperson');
  });
});

describe('a page that builds itself with JavaScript', () => {
  const url = 'https://app.example.test/';
  const web = () => fakeWeb({ [url]: html(SHELL) });

  test('it is opened in the isolated browser and its visible text is read', async () => {
    const result = await readCvLink({
      url,
      fetchDocument: web(),
      renderPage: async (asked) => {
        assert.equal(asked, url);
        return { text: RENDERED_TEXT, anchors: [], links: [] };
      },
    });
    assert.equal(result.source.format, 'rendered');
    assert.equal(result.formDraft.fullName, 'Nimali Testperson');
    assert.equal(result.formDraft.phone, '0700000001');
    assert.equal(result.formDraft.phone2, '0710000002');
    assert.equal(result.formDraft.email, 'nimali.testperson@example.test');
    assert.equal(result.formDraft.alResult, '2 Credits and 1 Pass');
    assert.equal(result.hints.appliedPosition, 'Imaginary Web Developer');
  });

  test('a CV document linked from the rendered page is read too', async () => {
    const pdf = await buildPdf(FULL_CV);
    const fetchDocument = fakeWeb({
      [url]: html(SHELL),
      'https://app.example.test/my-cv.pdf': pdf,
    });
    const result = await readCvLink({
      url,
      fetchDocument,
      renderPage: async () => ({
        text: 'Nimali Testperson\nA short profile of a fictional person that is long enough to read.',
        anchors: [{ href: 'https://app.example.test/my-cv.pdf', text: 'Download CV' }],
        links: ['https://app.example.test/my-cv.pdf'],
      }),
    });
    assert.equal(result.source.linkedDocument, true);
    assert.equal(result.formDraft.olMaths, 'A');
  });

  test('where no browser is available the reason is stated, nothing is invented', async () => {
    const result = await readCvLink({ url, fetchDocument: web(), renderPage: noRender });
    assert.equal(result.status, 'failed');
    assert.equal(result.reason, 'render_unavailable');
    assert.match(result.message, /JavaScript/);
    assert.deepEqual(result.formDraft, {});
  });

  test('without any renderer configured the reason is the same', async () => {
    const result = await readCvLink({ url, fetchDocument: web() });
    assert.equal(result.reason, 'render_unavailable');
  });

  test('a page that blocks automated access is reported as blocked', async () => {
    const result = await readCvLink({
      url,
      fetchDocument: web(),
      renderPage: async () => {
        throw Object.assign(new Error('The site blocks automated access.'), { reason: 'blocked' });
      },
    });
    assert.equal(result.reason, 'blocked');
    assert.match(result.message, /automated access/);
  });

  test('a rendered page with almost no text is reported, not filled', async () => {
    const result = await readCvLink({
      url,
      fetchDocument: web(),
      renderPage: async () => ({ text: 'Loading...', anchors: [], links: [] }),
    });
    assert.equal(result.status, 'failed');
    assert.equal(result.reason, 'empty_page');
  });
});

describe('through the real routes', () => {
  let h;
  let hr;
  let web = {};
  let rendered = 0;

  before(async () => {
    h = await startMemoryHarness({
      extraDeps: {
        fetchDocument: async (url) => {
          const hit = web[url];
          if (hit instanceof Error) throw hit;
          if (!hit) throw new FetchRefused('unreachable', 'The link could not be opened.');
          return { buffer: hit };
        },
        renderPage: async () => {
          rendered += 1;
          return { text: RENDERED_TEXT, anchors: [], links: [] };
        },
      },
    });
    hr = await h.signedIn({ roleCode: 'hr' });
  });
  after(() => h.stop());

  const link = (url) =>
    h.api('/candidates/extract-cv/link', { method: 'POST', cookie: hr.cookie, body: { url } });
  const candidates = async () => (await h.query('SELECT count(*)::int AS n FROM candidates'))[0].n;

  test('a JavaScript site is rendered and its details returned, with nobody registered', async () => {
    web = { 'https://app.example.test/': html(SHELL) };
    rendered = 0;
    const before = await candidates();
    const res = await link('https://app.example.test/');
    assert.equal(res.status, 200);
    assert.equal(rendered, 1);
    assert.equal(res.body.cvUrl, 'https://app.example.test/');
    assert.equal(res.body.extraction.formDraft.phone2, '0710000002');
    assert.equal(res.body.extraction.formDraft.fullName, 'Nimali Testperson');
    assert.equal(await candidates(), before);
  });

  test('a PDF link is read as before and never touches the browser', async () => {
    web = { 'https://files.example.test/cv.pdf?v=2': await buildPdf(FULL_CV) };
    rendered = 0;
    const res = await link('https://files.example.test/cv.pdf?v=2');
    assert.equal(res.status, 200);
    assert.equal(rendered, 0);
    assert.equal(res.body.extraction.formDraft.email, 'nimali.testperson@example.test');
  });

  test('an unreachable page, a sign-in page and a redirect are refused with their reasons', async () => {
    web = {
      'https://gone.example.test/': new FetchRefused(
        'unreachable',
        'The link could not be opened.',
      ),
      'https://login.example.test/': new FetchRefused(
        'needs_login',
        'The link needs a sign-in, which is not supported.',
      ),
      'https://moved.example.test/': new FetchRefused('redirect', 'The link redirects elsewhere.'),
    };
    for (const [url, status, reason] of [
      ['https://gone.example.test/', 502, 'unreachable'],
      ['https://login.example.test/', 422, 'needs_login'],
      ['https://moved.example.test/', 422, 'redirect'],
    ]) {
      const res = await link(url);
      assert.equal(res.status, status, url);
      assert.equal(res.body.error, 'link_refused', url);
      assert.equal(res.body.reason, reason, url);
    }
  });

  test('private, internal and unsafe addresses never reach the browser', async () => {
    // A second app WITHOUT the stubbed fetcher, so the real safe fetcher is in the path.
    let rendersTried = 0;
    const real = await startMemoryHarness({
      extraDeps: {
        renderPage: async () => {
          rendersTried += 1;
          return { text: RENDERED_TEXT, anchors: [], links: [] };
        },
      },
    });
    try {
      const user = await real.signedIn({ roleCode: 'hr' });
      for (const url of [
        'https://localhost/cv',
        'https://127.0.0.1/cv',
        'https://169.254.169.254/latest/meta-data/',
        'https://[::1]/cv',
        'https://10.0.0.5/cv',
        'https://192.168.1.10:8443/cv',
        'http://cv.example.test/cv',
        'ftp://cv.example.test/cv',
        'file:///etc/passwd',
        'https://user:secret@cv.example.test/cv',
        'https://cv.example.test:8443/cv',
      ]) {
        const res = await real.api('/candidates/extract-cv/link', {
          method: 'POST',
          cookie: user.cookie,
          body: { url },
        });
        assert.equal(res.status, 422, url);
        assert.equal(res.body.error, 'link_refused', url);
        assert.equal(JSON.stringify(res.body).includes('secret'), false, url);
      }
      assert.equal(rendersTried, 0);
    } finally {
      await real.stop();
    }
  });
});
