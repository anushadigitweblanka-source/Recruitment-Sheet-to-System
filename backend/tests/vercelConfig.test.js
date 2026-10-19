import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

// Guards the Vercel deployment setup. It reads files only: nothing here deploys,
// connects to a database or sends mail.

const root = (path) => fileURLToPath(new URL(`../../${path}`, import.meta.url));
const vercel = JSON.parse(readFileSync(root('vercel.json'), 'utf8'));

test('vercel.json defines the backend and frontend services with real folders', () => {
  assert.deepEqual(Object.keys(vercel.services).sort(), ['backend', 'frontend']);
  for (const service of Object.values(vercel.services)) {
    assert.ok(
      existsSync(root(`${service.root}/package.json`)),
      `${service.root} has no package.json`,
    );
  }
  assert.ok(existsSync(root(`backend/${vercel.services.backend.entrypoint}`)));
});

test('only /api reaches the backend, everything else the frontend, most specific first', () => {
  const [api, rest, ...extra] = vercel.rewrites;
  assert.equal(extra.length, 0);
  assert.equal(api.source, '/api/(.*)');
  assert.deepEqual(api.destination, { service: 'backend' });
  assert.equal(rest.source, '/(.*)');
  assert.deepEqual(rest.destination, { service: 'frontend' });
});

test('direct visits to routes like /candidates fall back to the single-page app', () => {
  assert.deepEqual(vercel.services.frontend.rewrites, [
    { source: '/(.*)', destination: '/index.html' },
  ]);
});

test('no build or runtime key sits at the top level, and no service binds to another', () => {
  for (const key of [
    'framework',
    'buildCommand',
    'installCommand',
    'outputDirectory',
    'functions',
  ]) {
    assert.equal(key in vercel, false, `${key} must live inside a service`);
  }
  // The browser calls /api on the same address; the backend never calls the
  // frontend, so there is nothing to bind.
  for (const service of Object.values(vercel.services)) {
    assert.equal(service.bindings, undefined);
  }
  assert.equal(JSON.stringify(vercel).includes('crons'), false, 'no scheduled job is enabled');
});

test('the Vercel entry exports the app without starting a scheduler or a listener', async () => {
  Object.assign(process.env, {
    DB_HOST: 'db.example.test',
    DB_PORT: '5432',
    DB_NAME: 'fictional_db',
    DB_USER: 'fictional_user',
    DB_PASSWORD: 'not-a-real-password',
  });
  const source = readFileSync(root('backend/src/index.js'), 'utf8');
  assert.equal(/setInterval|\.listen\(|runNotificationScheduler|migrate/.test(source), false);

  const entry = await import('../src/index.js');
  assert.equal(typeof entry.default, 'function');
  assert.equal(typeof entry.default.handle, 'function');
});

test('private and local-only material is kept out of a CLI upload', () => {
  const ignored = readFileSync(root('.vercelignore'), 'utf8');
  for (const entry of ['.env', 'prompts/', 'validation/', '*.csv', 'backend/.dev-storage/']) {
    assert.ok(ignored.split(/\r?\n/).includes(entry), `${entry} should be ignored`);
  }
});

// The entry app is the same Express app, so the same sign-in gate applies. These
// requests carry no session cookie, so they are refused before any database use.
test('the Vercel entry app refuses signed-out requests to protected routes', async () => {
  Object.assign(process.env, {
    DB_HOST: 'db.example.test',
    DB_PORT: '5432',
    DB_NAME: 'fictional_db',
    DB_USER: 'fictional_user',
    DB_PASSWORD: 'not-a-real-password',
  });
  const { default: app } = await import('../src/index.js');
  const server = app.listen(0, '127.0.0.1');
  after(() => new Promise((resolve) => server.close(resolve)));
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  for (const path of [
    '/api/candidates',
    '/api/salary/1',
    '/api/offers',
    '/api/employees',
    '/api/admin/users',
    '/api/admin/audit-log',
    '/api/company-accounts',
    '/api/recruitment-records',
    '/api/notifications',
    '/api/email-log',
    '/api/reports/summary',
  ]) {
    const res = await fetch(base + path);
    assert.equal(res.status, 401, `${path} should need a sign-in`);
    assert.equal(res.headers.get('cache-control'), 'no-store');
  }
  // Writing without a session is refused too.
  const write = await fetch(`${base}/api/candidates`, { method: 'POST' });
  assert.equal(write.status, 401);
});
