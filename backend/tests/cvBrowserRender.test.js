// Tests the isolated browser renderer with a REAL headless Chrome/Edge (found on
// this machine) and the REAL request rules (fetchSubresource), over a stubbed
// network: DNS is a stub and the HTTPS transport is a fake web held in memory,
// so nothing leaves this computer. The "site" is a fictional page that builds
// itself with JavaScript and also tries to reach internal addresses.
//
// Skipped where no browser is installed (the renderer is off there too).

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  RenderFailed,
  RenderUnavailable,
  findBrowser,
  renderPage,
} from '../src/modules/cv-extraction/browserRender.js';
import { PUBLIC_IP, fakeNetwork } from './helpers/fakeBrowserWeb.js';

const browser = findBrowser();

const APP_JS = `
const root = document.getElementById('root');
async function probe(url) {
  try { await fetch(url, { mode: 'no-cors' }); return 'reached'; } catch { return 'blocked'; }
}
(async () => {
  const internal = await probe('https://internal.example.test/secret');
  const metadata = await probe('https://169.254.169.254/latest/meta-data/');
  const plain = await probe('http://app.example.test/plain');
  const port = await probe('https://app.example.test:8443/x');
  const data = await (await fetch('/data.json')).json();
  root.innerHTML =
    '<h1>' + data.name + '</h1>' +
    '<p>Mobile: ' + data.phone + '</p>' +
    '<p>Email: <a href="mailto:' + data.email + '">' + data.email + '</a></p>' +
    '<a href="/files/cv.pdf">Download CV</a>' +
    '<p id="probe">internal:' + internal + ' metadata:' + metadata + ' http:' + plain + ' port:' + port + '</p>';
})();
`;

const SITE = {
  'app.example.test/': {
    type: 'text/html',
    body: '<!doctype html><html><head><title>Portfolio</title></head><body><div id="root"></div><script src="/app.js"></script></body></html>',
  },
  'app.example.test/app.js': { type: 'text/javascript', body: APP_JS },
  'app.example.test/data.json': {
    type: 'application/json',
    body: JSON.stringify({
      name: 'Nimali Testperson',
      phone: '070 000 0001',
      email: 'nimali.testperson@example.test',
    }),
    headers: { 'set-cookie': 'session=abc; Path=/' },
  },
};

describe(
  'the isolated browser renderer',
  { skip: browser ? false : 'no browser installed' },
  () => {
    test('a JavaScript-built page is rendered and its visible text read', async () => {
      const net = fakeNetwork(SITE);
      const out = await renderPage('https://app.example.test/', {
        fetchSubresource: net.fetchThroughRules,
        executablePath: browser,
      });
      assert.match(out.text, /Nimali Testperson/);
      assert.match(out.text, /Mobile: 070 000 0001/);
      assert.match(out.text, /Email: nimali\.testperson@example\.test/);
      assert.ok(out.links.some((link) => link.startsWith('mailto:nimali.testperson@example.test')));
      assert.ok(
        out.anchors.some(
          (a) => a.href === 'https://app.example.test/files/cv.pdf' && /CV/.test(a.text),
        ),
      );
    });

    test('the page cannot reach internal addresses, other ports or plain http', async () => {
      const net = fakeNetwork(SITE);
      const out = await renderPage('https://app.example.test/', {
        fetchSubresource: net.fetchThroughRules,
        executablePath: browser,
      });
      assert.match(out.text, /internal:blocked metadata:blocked http:blocked port:blocked/);
      // Only the public site was ever contacted, and only at the checked address.
      assert.ok(net.requests.length >= 3);
      for (const request of net.requests) {
        assert.equal(request.host, PUBLIC_IP);
        assert.equal(request.hostname, 'app.example.test');
      }
      assert.equal(
        net.requests.some((r) => /secret|meta-data|plain|x$/.test(r.path)),
        false,
      );
    });

    test('no cookies or credentials are ever sent, even after the site sets one', async () => {
      const net = fakeNetwork(SITE);
      await renderPage('https://app.example.test/', {
        fetchSubresource: net.fetchThroughRules,
        executablePath: browser,
      });
      for (const { headers } of net.requests) {
        const names = Object.keys(headers).map((n) => n.toLowerCase());
        for (const forbidden of ['cookie', 'authorization', 'proxy-authorization']) {
          assert.equal(names.includes(forbidden), false, forbidden);
        }
      }
    });

    test('a redirect to an internal address is checked and refused', async () => {
      const net = fakeNetwork({
        'app.example.test/': {
          status: 302,
          headers: { location: 'https://internal.example.test/admin' },
          body: '',
        },
      });
      await assert.rejects(
        renderPage('https://app.example.test/', {
          fetchSubresource: net.fetchThroughRules,
          executablePath: browser,
        }),
        (error) => error instanceof RenderFailed,
      );
      assert.equal(
        net.requests.some((r) => r.hostname === 'internal.example.test'),
        false,
      );
    });

    test('a page that needs a sign-in is reported, not worked around', async () => {
      const net = fakeNetwork({
        'app.example.test/': { status: 401, type: 'text/html', body: 'Sign in' },
      });
      await assert.rejects(
        renderPage('https://app.example.test/', {
          fetchSubresource: net.fetchThroughRules,
          executablePath: browser,
        }),
        (error) => error instanceof RenderFailed && error.reason === 'blocked',
      );
    });

    test('a human check page is reported as blocked', async () => {
      const net = fakeNetwork({
        'app.example.test/': {
          type: 'text/html',
          body: '<html><body><p>Please verify you are human. CAPTCHA</p></body></html>',
        },
      });
      await assert.rejects(
        renderPage('https://app.example.test/', {
          fetchSubresource: net.fetchThroughRules,
          executablePath: browser,
        }),
        (error) => error instanceof RenderFailed && error.reason === 'blocked',
      );
    });
  },
);

describe('when rendering is not possible', () => {
  test('no browser path means rendering is unavailable, with a reason', async () => {
    await assert.rejects(
      renderPage('https://app.example.test/', {
        fetchSubresource: async () => {},
        executablePath: null,
      }),
      (error) => error instanceof RenderUnavailable && error.reason === 'no_browser',
    );
  });

  test('rendering is switched off on Vercel and when disabled', () => {
    const exists = () => true;
    assert.equal(findBrowser({ env: { VERCEL: '1', CV_RENDER_BROWSER_PATH: '/x' }, exists }), null);
    assert.equal(
      findBrowser({ env: { CV_RENDER_DISABLED: 'true', CV_RENDER_BROWSER_PATH: '/x' }, exists }),
      null,
    );
    assert.equal(findBrowser({ env: { CV_RENDER_BROWSER_PATH: '/x' }, exists }), '/x');
    assert.equal(findBrowser({ env: {}, platform: 'linux', exists: () => false }), null);
  });
});
