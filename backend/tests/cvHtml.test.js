// Tests for reading a CV from a public HTML page. Everything is fictional and
// in memory: the page is a made-up document, the network is a stub and the
// database is a throwaway in-memory Postgres (PGlite), so nothing real is
// read, fetched or changed.

import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { after, before, describe, test } from 'node:test';
import { extractCv } from '../src/modules/cv-extraction/extractCv.js';
import { htmlToText } from '../src/modules/cv-extraction/htmlText.js';
import { FetchRefused, fetchCvDocument } from '../src/modules/cv-extraction/safeFetch.js';
import { startMemoryHarness } from './helpers/memoryDb.js';

const PUBLIC_IP = '93.184.216.34';

const FICTIONAL_PAGE = `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8"><title>Nimali Testperson CV</title>
<style>.hidden-style { content: "Phone: 070 999 9999"; }</style>
<script>var secret = "Email: injected@example.test"; document.write("Name: Script Person");</script>
</head><body>
<nav><a href="#education">Education</a> <a href="#skills">Skills</a></nav>
<header><h1>Nimali Testperson</h1>
<p>Applied Position: Imaginary Web Developer</p></header>
<section>
<p>Phone: 070 000 0001</p>
<p>Email: <a href="mailto:nimali.testperson@example.test">Write to me</a></p>
<p>Address: 12 Fictional Lane,<br>Examplepura, Testland</p>
<p><a href="https://www.linkedin.com/in/nimali-testperson/">LinkedIn</a></p>
</section>
<section id="education"><h2>Education</h2>
<p>G.C.E. Ordinary Level (2018) - Fictional College</p>
<p>Mathematics: A, Science: B, English: C</p>
<p>G.C.E. Advanced Level (2021) - Fictional College</p>
<p>Stream: Physical Science</p>
<p>Results: 2 Credits and 1 Pass</p>
<p>BSc in Imaginary Computing, Fictional University (2022 - 2026)</p>
</section>
<section id="skills"><h2>Skills</h2><p>Pretend programming, imaginary databases</p></section>
<!-- Phone: 070 888 8888 -->
</body></html>`;

const SPARSE_PAGE = `<!doctype html><html><body><h1>Kasun Dummyman</h1>
<p>Email: kasun.dummyman@example.test</p>
<p>${'A short fictional profile that has no contact details or education. '.repeat(4)}</p></body></html>`;

const JS_ONLY_PAGE = `<!doctype html><html><head><title>App</title></head>
<body><div id="root"></div><script src="/bundle.js"></script></body></html>`;

const html = (text) => Buffer.from(text, 'utf8');

function fakeTransport(body, status = 200) {
  const calls = [];
  const transport = (options, onResponse) => {
    calls.push(options);
    const req = new EventEmitter();
    req.destroy = () => {};
    req.end = () => {
      const res = new PassThrough();
      res.statusCode = status;
      res.headers = {};
      setImmediate(() => {
        onResponse(res);
        res.write(body);
        res.end();
      });
    };
    return req;
  };
  transport.calls = calls;
  return transport;
}
const resolve = async () => [{ address: PUBLIC_IP, family: 4 }];
const fetchPage = (body, status) =>
  fetchCvDocument('https://cv.example.test/me.html', {
    resolve,
    transport: fakeTransport(body, status),
  });

describe('HTML to text', () => {
  test('scripts, styles, comments and navigation are not CV text', () => {
    const { text } = htmlToText(html(FICTIONAL_PAGE));
    for (const hidden of ['injected@', 'Script Person', '070 999', '070 888', 'hidden-style']) {
      assert.equal(text.includes(hidden), false, hidden);
    }
    assert.match(text, /Nimali Testperson/);
  });

  test('link addresses are collected and a mailto address is made visible', () => {
    const { text, links } = htmlToText(html(FICTIONAL_PAGE));
    assert.ok(links.includes('https://www.linkedin.com/in/nimali-testperson/'));
    assert.match(text, /nimali\.testperson@example\.test/);
  });

  test('entities are decoded', () => {
    const { text } = htmlToText(html('<p>Fish &amp; Chips &#169;</p>'));
    assert.match(text, /Fish & Chips ©/);
  });
});

describe('fetching an HTML page', () => {
  test('a page is downloaded over the same checked connection as a PDF', async () => {
    const transport = fakeTransport(FICTIONAL_PAGE);
    const result = await fetchCvDocument('https://cv.example.test/me.html', { resolve, transport });
    assert.equal(result.buffer.toString().startsWith('<!DOCTYPE html>'), true);
    assert.equal(transport.calls[0].host, PUBLIC_IP);
    assert.match(transport.calls[0].headers.Accept, /text\/html/);
  });

  test('something that is neither a document nor a page is still refused', async () => {
    await assert.rejects(
      fetchPage(Buffer.from('{"json": true}')),
      (err) => err instanceof FetchRefused && err.reason === 'not_a_document',
    );
  });

  test('a redirect is still refused', async () => {
    await assert.rejects(
      fetchPage('', 302),
      (err) => err instanceof FetchRefused && err.reason === 'redirect',
    );
  });
});

describe('extracting from a page', () => {
  test('every supported field is read from the page text and links', async () => {
    const result = await extractCv({ buffer: html(FICTIONAL_PAGE), allowHtml: true });
    assert.equal(result.source.format, 'html');
    assert.deepEqual(result.formDraft, {
      fullName: 'Nimali Testperson',
      phone: '0700000001',
      email: 'nimali.testperson@example.test',
      address: '12 Fictional Lane, Examplepura, Testland',
      olMaths: 'A',
      alResult: '2 Credits and 1 Pass',
      alStream: 'Physical Science',
      otherEducation: 'BSc in Imaginary Computing, Fictional University (2022 - 2026)',
      linkedinUrl: 'https://www.linkedin.com/in/nimali-testperson',
    });
    assert.equal(result.hints.appliedPosition, 'Imaginary Web Developer');
  });

  test('missing information stays empty', async () => {
    const result = await extractCv({ buffer: html(SPARSE_PAGE), allowHtml: true });
    assert.deepEqual(Object.keys(result.formDraft).sort(), ['email', 'fullName']);
    assert.equal(result.status, 'partial');
  });

  test('a page that needs JavaScript is explained, not guessed at', async () => {
    const result = await extractCv({ buffer: html(JS_ONLY_PAGE), allowHtml: true });
    assert.equal(result.status, 'failed');
    assert.equal(result.reason, 'needs_javascript');
    assert.match(result.message, /JavaScript/);
    assert.deepEqual(result.formDraft, {});
  });

  test('an uploaded file is never read as a web page', async () => {
    const result = await extractCv({ buffer: html(FICTIONAL_PAGE) });
    assert.equal(result.status, 'failed');
    assert.equal(result.reason, 'unsupported_format');
  });
});

describe('through the real routes', () => {
  let h;
  let hr;
  let page = null;

  before(async () => {
    h = await startMemoryHarness({
      extraDeps: {
        fetchDocument: async () => ({ buffer: page }),
        renderPage: async () => {
          throw Object.assign(new Error('no browser'), { reason: 'no_browser' });
        },
      },
    });
    hr = await h.signedIn({ roleCode: 'hr' });
  });
  after(() => h.stop());

  const link = (url = 'https://cv.example.test/me.html') =>
    h.api('/candidates/extract-cv/link', { method: 'POST', cookie: hr.cookie, body: { url } });
  const candidateCount = async () =>
    (await h.query('SELECT count(*)::int AS n FROM candidates'))[0].n;

  test('a page link returns the same details a document would, and registers nobody', async () => {
    page = html(FICTIONAL_PAGE);
    const before = await candidateCount();
    const res = await link();
    assert.equal(res.status, 200);
    assert.equal(res.body.cvUrl, 'https://cv.example.test/me.html');
    assert.equal(res.body.extraction.formDraft.fullName, 'Nimali Testperson');
    assert.equal(res.body.extraction.formDraft.phone, '0700000001');
    assert.equal(await candidateCount(), before);
  });

  test('a page without readable text answers with a clear reason', async () => {
    page = html(JS_ONLY_PAGE);
    const res = await link();
    assert.equal(res.status, 422);
    assert.equal(res.body.error, 'extraction_failed');
    assert.equal(res.body.reason, 'render_unavailable');
    assert.match(res.body.message, /JavaScript/);
  });

  test('uploading a web page as a file is refused', async () => {
    const res = await h.api('/candidates/extract-cv/file', {
      method: 'POST',
      cookie: hr.cookie,
      headers: { 'Content-Type': 'application/pdf' },
      rawBody: html(FICTIONAL_PAGE),
    });
    assert.equal(res.status, 422);
  });
});
