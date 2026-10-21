// Why a CV page can open fine and still show almost no text, and what the
// renderer must do about each cause. A REAL headless Chrome/Edge (found on this
// machine) renders fictional pages served from memory by a fake web; the real
// request rules apply on top (see helpers/fakeBrowserWeb.js). Nothing leaves this
// computer. Skipped where no browser is installed.
//
// Causes covered: content that appears late, behind a loading splash, only after
// scrolling, inside an iframe or a shadow root, in structured data added by a
// script, or in an embedded PDF - and, where nothing can be read, the SPECIFIC
// reason (data requests that are not allowed, a refused host, an error from the
// page's data service, an image-only page) instead of one generic sentence.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  RenderFailed,
  findBrowser,
  renderPage,
} from '../src/modules/cv-extraction/browserRender.js';
import { fakeNetwork } from './helpers/fakeBrowserWeb.js';

const browser = findBrowser();
const HOST = 'app.example.test';
const URL_ = `https://${HOST}/`;

const CV_HTML = `
  <h1>Nimali Testperson</h1>
  <p>Mobile: 070 000 0001</p>
  <p>Email: nimali.testperson@example.test</p>
  <p>Address: 12 Fictional Lane, Examplepura, Testland</p>
  <h2>Education</h2>
  <p>G.C.E. Advanced Level (2021) - Fictional College</p>
  <p>Stream: Physical Science</p>`;

const page = (body, script = '') => ({
  type: 'text/html',
  body: `<!doctype html><html><head><title>Portfolio</title></head><body>${body}${
    script ? `<script src="/app.js"></script>` : ''
  }</body></html>`,
});
const js = (code) => ({ type: 'text/javascript', body: code });

async function render(site) {
  const net = fakeNetwork(site);
  const out = await renderPage(URL_, {
    fetchSubresource: net.fetchThroughRules,
    executablePath: browser,
  });
  return { out, net };
}
async function renderFailure(site) {
  try {
    await render(site);
  } catch (error) {
    assert.ok(error instanceof RenderFailed, `unexpected ${error}`);
    return error;
  }
  assert.fail('the render was expected to fail');
}
const readable = (text) => {
  assert.match(text, /Nimali Testperson/);
  assert.match(text, /Email: nimali\.testperson@example\.test/);
  assert.match(text, /Stream: Physical Science/);
};

describe('content that arrives late or out of sight', { skip: !browser, timeout: 600_000 }, () => {
  test('a page that shows a loading splash for several seconds is waited for', async () => {
    const { out } = await render({
      [`${HOST}/`]: page('<div id="root">Loading…</div>', true),
      [`${HOST}/app.js`]: js(
        `setTimeout(() => { document.getElementById('root').innerHTML = ${JSON.stringify(CV_HTML)}; }, 4500);`,
      ),
    });
    readable(out.text);
  });

  test('content added only when the page is scrolled is read', async () => {
    const { out } = await render({
      [`${HOST}/`]: page(
        '<div style="height:4000px">Scroll for more</div><div id="more"></div>',
        true,
      ),
      [`${HOST}/app.js`]: js(
        `addEventListener('scroll', () => { if (scrollY > 200 && !window.done) { window.done = true; document.getElementById('more').innerHTML = ${JSON.stringify(CV_HTML)}; } });`,
      ),
    });
    readable(out.text);
  });

  test('content inside an iframe (same site or another site) is read', async () => {
    const { out } = await render({
      [`${HOST}/`]: page(
        '<h2>My CV</h2><iframe src="/frame.html"></iframe><iframe src="https://frames.example.test/cv.html"></iframe>',
      ),
      [`${HOST}/frame.html`]: page(CV_HTML),
      'frames.example.test/cv.html': page('<p>Phone: 071 000 0002</p>'),
    });
    readable(out.text);
    assert.match(out.text, /Phone: 071 000 0002/);
  });

  test('content inside an open shadow root, even a nested one, is read', async () => {
    const { out } = await render({
      [`${HOST}/`]: page('<cv-card></cv-card>', true),
      [`${HOST}/app.js`]: js(`
        class Inner extends HTMLElement { constructor() { super(); this.attachShadow({ mode: 'open' }).innerHTML = '<p>Phone: 071 000 0002</p>'; } }
        customElements.define('cv-inner', Inner);
        class Card extends HTMLElement { constructor() { super(); this.attachShadow({ mode: 'open' }).innerHTML = ${JSON.stringify(CV_HTML)} + '<cv-inner></cv-inner>'; } }
        customElements.define('cv-card', Card);`),
    });
    readable(out.text);
    assert.match(out.text, /Phone: 071 000 0002/);
  });

  test('structured data a script adds after loading is returned', async () => {
    const person = JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'Person',
      name: 'Nimali Testperson',
      email: 'nimali.testperson@example.test',
    });
    const { out } = await render({
      [`${HOST}/`]: page('<div id="root">Hello</div>', true),
      [`${HOST}/app.js`]: js(
        `setTimeout(() => { const s = document.createElement('script'); s.type = 'application/ld+json'; s.textContent = ${JSON.stringify(person)}; document.head.appendChild(s); }, 800);`,
      ),
    });
    assert.equal(out.ldjson.length, 1);
    assert.equal(JSON.parse(out.ldjson[0]).name, 'Nimali Testperson');
  });

  test('a PDF embedded in the page is offered as a document link', async () => {
    const { out } = await render({
      [`${HOST}/`]: page(
        '<h2>My CV</h2><iframe src="/files/my-cv.pdf"></iframe><embed src="/files/other.pdf">',
      ),
      [`${HOST}/files/my-cv.pdf`]: { type: 'application/pdf', body: '%PDF-1.4 fake' },
    });
    const links = out.anchors.map((a) => a.href);
    assert.ok(links.includes(`https://${HOST}/files/my-cv.pdf`));
    assert.ok(links.includes(`https://${HOST}/files/other.pdf`));
  });
});

describe(
  'when nothing can be read, the reason is specific',
  { skip: !browser, timeout: 600_000 },
  () => {
    test('content that needs POST requests says so', async () => {
      const error = await renderFailure({
        [`${HOST}/`]: page('<div id="root">Loading…</div>', true),
        [`${HOST}/app.js`]: js(
          `fetch('/api/cv', { method: 'POST', body: '{}' }).then((r) => r.text()).then((t) => { document.getElementById('root').textContent = t; }).catch(() => {});`,
        ),
      });
      assert.equal(error.reason, 'content_needs_post');
      assert.match(error.message, /POST/);
    });

    test('a data service that answers 403 is reported as refusing access', async () => {
      const error = await renderFailure({
        [`${HOST}/`]: page('<div id="root">Loading…</div>', true),
        [`${HOST}/app.js`]: js(
          `fetch('/api/cv').then((r) => r.ok ? r.text() : null).then((t) => { if (t) document.getElementById('root').textContent = t; });`,
        ),
        [`${HOST}/api/cv`]: { type: 'application/json', status: 403, body: '{}' },
      });
      assert.equal(error.reason, 'blocked');
      assert.match(error.message, /403/);
    });

    test('content that lives at an internal address names the refused host', async () => {
      const error = await renderFailure({
        [`${HOST}/`]: page('<div id="root">Loading…</div>', true),
        [`${HOST}/app.js`]: js(
          `fetch('https://internal.example.test/cv').then((r) => r.text()).then((t) => { document.getElementById('root').textContent = t; }).catch(() => {});`,
        ),
      });
      assert.equal(error.reason, 'content_blocked');
      assert.match(error.message, /internal\.example\.test/);
    });

    test('a page that is only images says so', async () => {
      const error = await renderFailure({
        [`${HOST}/`]: page('<img src="/cv.png" alt=""><canvas width="400" height="300"></canvas>'),
      });
      assert.equal(error.reason, 'image_only');
      assert.match(error.message, /image/i);
    });

    test('a page that finishes loading with no text and no clue says so plainly', async () => {
      const error = await renderFailure({ [`${HOST}/`]: page('<div id="root"></div>') });
      assert.equal(error.reason, 'empty_page');
      assert.match(error.message, /no readable text/);
    });
  },
);
