// Starts the isolated renderer (renderWorker.js) for one link and returns what
// it reports. The page's scripts only ever run inside that child's browser, never
// in this process.
//
// The child gets a minimal environment - no database settings, no secrets, no
// cookies - and is killed (with its browser) if it overruns its time.

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { RenderFailed, RenderUnavailable, findBrowser } from './browserRender.js';

const WORKER = fileURLToPath(new URL('./renderWorker.js', import.meta.url));
const OVERALL_TIMEOUT_MS = 50_000;
const MAX_OUTPUT_BYTES = 3 * 1024 * 1024;
// Only what a browser needs to start. Nothing from the application's settings.
const PASSED_ENV = [
  'PATH',
  'SystemRoot',
  'windir',
  'TEMP',
  'TMP',
  'TMPDIR',
  'HOME',
  'USERPROFILE',
  'LOCALAPPDATA',
  'APPDATA',
  'ProgramFiles',
  'ProgramFiles(x86)',
  'CV_RENDER_BROWSER_PATH',
];

const UNAVAILABLE_MESSAGE =
  'Pages that build themselves with JavaScript cannot be read on this server, because it has no isolated browser for them.';

export async function renderCvPage(url, { timeoutMs = OVERALL_TIMEOUT_MS } = {}) {
  if (!findBrowser()) throw new RenderUnavailable('no_browser', UNAVAILABLE_MESSAGE);

  const env = {};
  for (const name of PASSED_ENV) if (process.env[name] !== undefined) env[name] = process.env[name];

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--max-old-space-size=256', WORKER, url], {
      env,
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    });
    const chunks = [];
    let size = 0;
    let done = false;
    const end = (fn, value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      fn(value);
    };
    const kill = () => {
      if (process.platform === 'win32') {
        spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
          stdio: 'ignore',
          windowsHide: true,
        });
      } else {
        child.kill('SIGKILL');
      }
    };
    const timer = setTimeout(() => {
      kill();
      end(reject, new RenderFailed('timeout', 'The page took too long to load.'));
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_OUTPUT_BYTES) {
        kill();
        return end(reject, new RenderFailed('too_large', 'The page is too large to read.'));
      }
      chunks.push(chunk);
    });
    child.on('error', () =>
      end(reject, new RenderUnavailable('launch_failed', UNAVAILABLE_MESSAGE)),
    );
    child.on('close', () => {
      let out;
      try {
        out = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        return end(reject, new RenderFailed('render_failed', 'The page could not be rendered.'));
      }
      if (out.ok) {
        return end(resolve, {
          text: out.text,
          links: out.links ?? [],
          anchors: out.anchors ?? [],
          ldjson: out.ldjson ?? [],
        });
      }
      const Kind = ['no_browser', 'no_playwright', 'launch_failed'].includes(out.reason)
        ? RenderUnavailable
        : RenderFailed;
      end(reject, new Kind(out.reason, out.message));
    });
  });
}
