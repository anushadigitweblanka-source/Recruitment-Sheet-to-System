// The separate process that opens a page in the isolated browser. It is started
// by renderPage.js with a minimal environment (no database settings, secrets or
// cookies) and prints one JSON line: { ok: true, text, links, anchors } or
// { ok: false, reason, message }. It never prints the page's text on failure and
// logs nothing.

import { RenderFailed, RenderUnavailable, findBrowser, renderPage } from './browserRender.js';
import { FetchRefused, fetchSubresource, parseCvLink } from './safeFetch.js';

const reply = (value) => process.stdout.write(JSON.stringify(value));

try {
  const url = process.argv[2];
  parseCvLink(url); // HTTPS, no credentials, standard port, a public host name
  const out = await renderPage(url, { fetchSubresource, executablePath: findBrowser() });
  reply({ ok: true, ...out });
} catch (error) {
  if (
    error instanceof RenderUnavailable ||
    error instanceof RenderFailed ||
    error instanceof FetchRefused
  ) {
    reply({ ok: false, reason: error.reason, message: error.message });
  } else {
    reply({ ok: false, reason: 'render_failed', message: 'The page could not be rendered.' });
  }
}
process.exit(0);
