// Renders a JavaScript-built CV page in an isolated, locked-down browser and
// returns its visible text. This module only runs inside the separate worker
// process (renderWorker.js); the application server never runs a page's scripts.
//
// How the page is kept away from everything else:
//   - The browser cannot reach the network by itself. Chrome is started with a
//     dead proxy and a host-resolver that resolves nothing, and EVERY request the
//     page makes (document, scripts, data calls) is intercepted and answered by
//     fetchSubresource(), which applies the CV-link rules to each one: HTTPS,
//     standard port, a public host name checked and pinned, no private,
//     loopback or cloud-metadata address, no credentials, no cookies.
//   - Redirects are returned to the browser as redirects, so the next request
//     comes back through the same check.
//   - Images, media and fonts are not downloaded. Only GET is allowed.
//   - Service workers, downloads, dialogs and pop-up windows are refused.
//   - A fresh, empty browser profile is used and thrown away.
//   - Limits: a total time, a number of requests and a total download size.
//
// It does not try to get past a login, a CAPTCHA or bot protection: a page that
// shows one is reported as blocked.

/* global document, window -- the functions given to page.evaluate run inside the browser page */
import { existsSync } from 'node:fs';
import { FetchRefused } from './safeFetch.js';

export class RenderUnavailable extends Error {
  constructor(reason, message) {
    super(message);
    this.reason = reason;
  }
}
export class RenderFailed extends Error {
  constructor(reason, message) {
    super(message);
    this.reason = reason;
  }
}

export const RENDER_TIMEOUT_MS = 35_000;
// Text shorter than this is treated as "not finished building yet" while waiting;
// text shorter than the second figure (with no other content) is "almost no text".
const MIN_USEFUL_CHARS = 200;
const MIN_READABLE_CHARS = 60;
const MAX_REQUESTS = 80;
const MAX_TOTAL_BYTES = 20 * 1024 * 1024;
const MAX_ANCHORS = 200;
const BLOCKED_TYPES = new Set(['image', 'media', 'font']);
const DROPPED_HEADERS = new Set([
  'set-cookie',
  'set-cookie2',
  'content-encoding',
  'content-length',
  'transfer-encoding',
  'connection',
  'keep-alive',
  'strict-transport-security',
]);
const CHALLENGE =
  /captcha|verify (?:that )?you are (?:a )?human|are you a robot|checking your browser|attention required|access denied/i;

const WINDOWS_BROWSERS = [
  ['ProgramFiles', 'Google/Chrome/Application/chrome.exe'],
  ['ProgramFiles(x86)', 'Google/Chrome/Application/chrome.exe'],
  ['LOCALAPPDATA', 'Google/Chrome/Application/chrome.exe'],
  ['ProgramFiles', 'Microsoft/Edge/Application/msedge.exe'],
  ['ProgramFiles(x86)', 'Microsoft/Edge/Application/msedge.exe'],
];
const OTHER_BROWSERS = [
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];

// The Chrome or Edge to drive, or null. CV_RENDER_BROWSER_PATH can name one.
// Rendering is off on Vercel (no browser there) and when CV_RENDER_DISABLED=true.
export function findBrowser({
  env = process.env,
  platform = process.platform,
  exists = existsSync,
} = {}) {
  if (env.VERCEL || env.CV_RENDER_DISABLED === 'true') return null;
  if (env.CV_RENDER_BROWSER_PATH)
    return exists(env.CV_RENDER_BROWSER_PATH) ? env.CV_RENDER_BROWSER_PATH : null;
  const candidates =
    platform === 'win32'
      ? WINDOWS_BROWSERS.filter(([variable]) => env[variable]).map(
          ([variable, rest]) => `${env[variable]}/${rest}`,
        )
      : OTHER_BROWSERS;
  return candidates.find((path) => exists(path)) ?? null;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const loadChromium = async () => {
  try {
    return (await import('playwright-core')).chromium;
  } catch {
    throw new RenderUnavailable(
      'no_playwright',
      'The browser driver is not installed on this server.',
    );
  }
};

function answerHeaders(headers) {
  const out = {};
  for (const [name, value] of Object.entries(headers)) {
    if (!DROPPED_HEADERS.has(name.toLowerCase()))
      out[name] = Array.isArray(value) ? value.join(', ') : String(value);
  }
  return out;
}

// What the page being rendered did, kept only as counts and host names (never
// paths, queries or page text) so an empty result can be explained.
function newDiagnostics() {
  return {
    blockedMethods: new Set(),
    refusedHosts: new Set(),
    httpErrors: new Set(),
    tooLarge: false,
    pending: 0,
    lastActivity: Date.now(),
  };
}

const hostOf = (url) => {
  try {
    return new URL(url).hostname;
  } catch {
    return 'an unknown host';
  }
};

// Runs INSIDE the browser page (in every frame). Returns the visible text of the
// document, of every open shadow root (nested ones too), the page's links and
// embedded documents, structured data, and how many pictures it holds.
function gatherInPage() {
  const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE']);
  const roots = [document];
  const texts = [document.body ? document.body.innerText : ''];
  for (let i = 0; i < roots.length && i < 300; i += 1) {
    for (const element of roots[i].querySelectorAll('*')) {
      if (element.shadowRoot) {
        roots.push(element.shadowRoot);
        texts.push(
          [...element.shadowRoot.children]
            .filter((child) => !SKIP.has(child.tagName))
            .map((child) => child.innerText || '')
            .join('\n'),
        );
      }
    }
  }
  const all = (selector) => roots.flatMap((root) => [...root.querySelectorAll(selector)]);
  const absolute = (value) => {
    try {
      return new URL(value, document.baseURI).href;
    } catch {
      return null;
    }
  };
  const anchors = all('a[href]').map((a) => ({
    href: a.href,
    text: (a.innerText || a.getAttribute('aria-label') || '').slice(0, 120),
  }));
  const embedded = [
    ...all('iframe[src]').map((e) => e.getAttribute('src')),
    ...all('embed[src]').map((e) => e.getAttribute('src')),
    ...all('object[data]').map((e) => e.getAttribute('data')),
  ]
    .map((value) => value && absolute(value))
    .filter((href) => href && /^https:/i.test(href))
    .map((href) => ({ href, text: 'embedded document' }));
  return {
    text: texts.join('\n'),
    anchors: [...anchors, ...embedded],
    ldjson: all('script[type="application/ld+json"]')
      .map((script) => script.textContent || '')
      .filter((json) => json.length > 0 && json.length < 100_000)
      .slice(0, 5),
    media: all('img, canvas, svg, video').length,
  };
}

// Scrolls through the page so content that appears only when it comes into view
// (lazy sections, reveal-on-scroll) is created, then returns to the top.
async function scrollThrough(page) {
  await page
    .evaluate(async () => {
      const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const step = Math.max(window.innerHeight, 400);
      for (
        let y = 0;
        y < 12 * step && y < document.documentElement.scrollHeight + step;
        y += step
      ) {
        window.scrollTo(0, y);
        await pause(200);
      }
      window.scrollTo(0, 0);
    })
    .catch(() => {});
}

// The text, links and structured data of the page and of every frame in it.
async function collect(page) {
  const main = await page.evaluate(gatherInPage).catch(() => null);
  if (!main) return null;
  const parts = [main];
  for (const frame of page.frames().slice(1, 7)) {
    parts.push(await frame.evaluate(gatherInPage).catch(() => null));
  }
  const found = parts.filter(Boolean);
  return {
    text: found
      .map((part) => part.text)
      .join('\n\n')
      .slice(0, 200_000),
    anchors: found.flatMap((part) => part.anchors).slice(0, MAX_ANCHORS),
    ldjson: found.flatMap((part) => part.ldjson).slice(0, 5),
    media: found.reduce((sum, part) => sum + part.media, 0),
  };
}

const visibleLength = (snapshot) => (snapshot ? snapshot.text.replace(/\s/g, '').length : 0);

// Why a page that opened and finished loading has no readable text, as a specific
// reason and message, from what the page tried to do.
function explainEmpty(diagnostics, snapshot, stillLoading) {
  const hosts = (set) => [...set].slice(0, 3).join(', ');
  if ([...diagnostics.httpErrors].some((status) => status === 401 || status === 403)) {
    return new RenderFailed(
      'blocked',
      'The page loads its content from a service that refused access (HTTP 401/403): it needs a sign-in or does not allow automated access, so it was not read.',
    );
  }
  if (diagnostics.blockedMethods.size > 0) {
    return new RenderFailed(
      'content_needs_post',
      `The page loads its content with ${[...diagnostics.blockedMethods].join('/')} requests (sending data to a service, or cross-site checks). Those are not allowed when reading a page, so it stayed empty. Use a PDF or Word link, or the site's CV download link.`,
    );
  }
  if (diagnostics.refusedHosts.size > 0) {
    return new RenderFailed(
      'content_blocked',
      `The page needs content from ${hosts(diagnostics.refusedHosts)}, which cannot be reached safely (a private or internal address, plain http, or a non-standard port), so it stayed empty.`,
    );
  }
  if ([...diagnostics.httpErrors].some((status) => status >= 500)) {
    return new RenderFailed(
      'data_error',
      'The service the page loads its content from answered with an error, so the page stayed empty. Try again later.',
    );
  }
  if (diagnostics.tooLarge) {
    return new RenderFailed(
      'too_large',
      'The page needs a file that is too large to load here, so it stayed empty.',
    );
  }
  if (snapshot && snapshot.media > 0) {
    return new RenderFailed(
      'image_only',
      'The page shows its CV as images or graphics, not text, and text in pictures is not read (no OCR). Use a PDF or Word link instead.',
    );
  }
  if (stillLoading) {
    return new RenderFailed(
      'slow',
      'The page was still loading when the time allowed for it ran out, and it had shown no text.',
    );
  }
  return new RenderFailed(
    'empty_page',
    'The page opened and finished loading but contains no readable text (its content may be inside a closed component, a PDF viewer or a picture).',
  );
}

// Opens `url` in the isolated browser and returns
//   { text, links, anchors, ldjson }
// (text of the page, its frames and open shadow roots; every link, including
// embedded documents; structured data). Throws RenderUnavailable when there is no
// browser, or RenderFailed with a specific reason when the page cannot be read.
// `fetchSubresource(url, { accept })` answers every request the page makes.
export async function renderPage(
  url,
  { fetchSubresource, executablePath, timeoutMs = RENDER_TIMEOUT_MS, chromium: given = null } = {},
) {
  if (!executablePath) {
    throw new RenderUnavailable(
      'no_browser',
      'No browser is available on this server to open the page.',
    );
  }
  const chromium = given ?? (await loadChromium());

  const startedAt = Date.now();
  let browser;
  const deadline = setTimeout(() => browser?.close().catch(() => {}), timeoutMs);
  try {
    try {
      browser = await chromium.launch({
        executablePath,
        headless: true,
        timeout: 15_000,
        args: [
          '--proxy-server=http://127.0.0.1:9',
          '--host-resolver-rules=MAP * ~NOTFOUND',
          '--disable-background-networking',
          '--disable-component-update',
          '--disable-sync',
          '--disable-extensions',
          '--disable-gpu',
          '--no-first-run',
          '--no-default-browser-check',
          '--mute-audio',
        ],
      });
    } catch {
      throw new RenderUnavailable(
        'launch_failed',
        'The browser could not be started on this server.',
      );
    }

    const context = await browser.newContext({
      serviceWorkers: 'block',
      acceptDownloads: false,
      ignoreHTTPSErrors: false,
      locale: 'en-US',
      reducedMotion: 'reduce',
      viewport: { width: 1280, height: 900 },
    });

    const diagnostics = newDiagnostics();
    let requests = 0;
    let downloaded = 0;
    await context.route('**/*', async (route) => {
      const request = route.request();
      const refuse = () => route.abort('blockedbyclient').catch(() => {});
      requests += 1;
      diagnostics.lastActivity = Date.now();
      if (request.method() !== 'GET') {
        diagnostics.blockedMethods.add(request.method());
        return refuse();
      }
      if (
        BLOCKED_TYPES.has(request.resourceType()) ||
        requests > MAX_REQUESTS ||
        downloaded > MAX_TOTAL_BYTES
      ) {
        return refuse();
      }
      diagnostics.pending += 1;
      try {
        const answer = await fetchSubresource(request.url(), {
          accept: request.headers().accept ?? '*/*',
        });
        downloaded += answer.body.length;
        if (answer.status >= 400 && answer.status !== 404)
          diagnostics.httpErrors.add(answer.status);
        await route.fulfill({
          status: answer.status,
          headers: answerHeaders(answer.headers),
          body: answer.body,
        });
      } catch (error) {
        if (error?.reason === 'too_large') diagnostics.tooLarge = true;
        else if (error instanceof FetchRefused && error.reason !== 'unreachable') {
          diagnostics.refusedHosts.add(hostOf(request.url()));
        }
        await refuse();
      } finally {
        diagnostics.pending -= 1;
        diagnostics.lastActivity = Date.now();
      }
    });
    // Any window other than the one opened below (a pop-up) is closed at once.
    let page = null;
    context.on('page', (popup) => {
      if (page && popup !== page) popup.close().catch(() => {});
    });

    page = await context.newPage();
    page.on('dialog', (dialog) => dialog.dismiss().catch(() => {}));

    let response;
    try {
      response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 12_000 });
    } catch {
      throw new RenderFailed('unreachable', 'The page could not be opened.');
    }
    if (!response || response.status() === 401 || response.status() === 403) {
      throw new RenderFailed(
        'blocked',
        'The site needs a sign-in or does not allow automated access, so it was not read.',
      );
    }
    if (response.status() >= 400) {
      throw new RenderFailed('unreachable', 'The page could not be opened.');
    }

    await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {});

    // Wait for the page to finish building itself: until nothing is loading, and
    // the readable text has stopped changing at a useful size. A loading splash
    // that stays the same is not "finished" - the page is scrolled once to start
    // anything that waits to be seen, and given longer before giving up.
    const settleUntil = startedAt + timeoutMs - 6_000;
    let snapshot = null;
    let last = -1;
    let stable = 0;
    let scrolled = false;
    let polls = 0;
    while (Date.now() < settleUntil) {
      snapshot = (await collect(page)) ?? snapshot;
      const length = visibleLength(snapshot);
      const idle = diagnostics.pending === 0 && Date.now() - diagnostics.lastActivity > 700;
      stable = length === last ? stable + 1 : 0;
      last = length;
      polls += 1;
      if (idle && length >= MIN_USEFUL_CHARS && stable >= 2) break;
      if (idle && stable >= 8 && (length > 0 || polls >= 12)) break;
      if (idle && !scrolled && stable >= 2 && length < MIN_USEFUL_CHARS) {
        scrolled = true;
        await scrollThrough(page);
        stable = 0;
      }
      await sleep(500);
    }
    if (!snapshot) {
      throw new RenderFailed('render_failed', 'The page could not be read once it had loaded.');
    }

    const text = snapshot.text;
    const length = visibleLength(snapshot);
    if (length < 400 && CHALLENGE.test(text)) {
      throw new RenderFailed(
        'blocked',
        'The site asks for a human check or blocks automated access, so it was not read.',
      );
    }
    // Structured data, a mail/phone link or an embedded document is something to
    // read even when the page shows little text.
    const hasOtherContent =
      snapshot.ldjson.length > 0 ||
      snapshot.anchors.some((anchor) => /^(mailto|tel):|\.(pdf|docx)(\?|$)/i.test(anchor.href));
    if (length < MIN_READABLE_CHARS && !hasOtherContent) {
      throw explainEmpty(diagnostics, snapshot, diagnostics.pending > 0);
    }
    return {
      text,
      anchors: snapshot.anchors,
      links: snapshot.anchors.map((anchor) => anchor.href),
      ldjson: snapshot.ldjson,
    };
  } finally {
    clearTimeout(deadline);
    await browser?.close().catch(() => {});
  }
}
