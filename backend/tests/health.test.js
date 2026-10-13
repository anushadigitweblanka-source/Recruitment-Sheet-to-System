import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createApp } from '../src/app.js';
import { loadConfig, loadEnvFile } from '../src/config/env.js';
import { createPool } from '../src/db/pool.js';

// Integration test: uses the real development database from .env.

let pool;
let server;
let baseUrl;
let dbPassword;

async function listen(app) {
  const s = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => s.once('listening', resolve));
  return s;
}

before(async () => {
  loadEnvFile();
  const config = loadConfig();
  dbPassword = config.db.password;
  pool = createPool(config.db);
  server = await listen(createApp({ config, pool }));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await pool.end();
});

test('GET /api/health reports a working database connection', async () => {
  const res = await fetch(`${baseUrl}/api/health`);
  const body = await res.json();

  assert.equal(res.status, 200);
  assert.equal(body.status, 'ok');
  assert.equal(body.database.status, 'connected');
  assert.equal(typeof body.environment, 'string');
});

test('GET /api/health does not expose credentials', async () => {
  const res = await fetch(`${baseUrl}/api/health`);
  const text = await res.text();

  assert.ok(!text.includes(dbPassword));
  assert.doesNotMatch(text, /password/i);
});

test('GET /api/health returns 503 when the database is unreachable', async () => {
  const config = loadConfig();
  // Port 1 is never a PostgreSQL server, so the connection is refused.
  const brokenPool = createPool({ ...config.db, port: 1 });
  const brokenServer = await listen(createApp({ config, pool: brokenPool }));

  try {
    const res = await fetch(`http://127.0.0.1:${brokenServer.address().port}/api/health`);
    const body = await res.json();

    assert.equal(res.status, 503);
    assert.equal(body.status, 'degraded');
    assert.equal(body.database.status, 'unavailable');
  } finally {
    await new Promise((resolve) => brokenServer.close(resolve));
    await brokenPool.end();
  }
});

test('other API routes are closed to visitors who are not signed in', async () => {
  const res = await fetch(`${baseUrl}/api/does-not-exist`);

  assert.equal(res.status, 401);
  assert.deepEqual(await res.json(), { error: 'Not signed in.' });
});
