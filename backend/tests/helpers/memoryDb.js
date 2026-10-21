// A throwaway, in-memory PostgreSQL (PGlite, real Postgres compiled to WASM)
// with the project's real migrations applied. It lets integration tests drive
// the real routes and SQL without any connection to recruitment_system_dev or
// any other server: nothing is read from .env and nothing leaves the process.

import { PGlite } from '@electric-sql/pglite';
import { createApp } from '../../src/app.js';
import { runMigrations } from '../../src/db/migrate.js';
import { createTestUser } from './testDb.js';

// Wraps one PGlite instance in the small part of the pg.Pool interface the
// application uses: query(), and connect() for transactions. A connection is
// held exclusively from connect() to release(), so transactions never mix.
function asPool(pg) {
  let tail = Promise.resolve();

  const run = async (sql, params) => {
    if (params === undefined || params.length === 0) {
      // Plain text may hold several statements (the migrations do).
      const results = await pg.exec(sql);
      const last = results[results.length - 1] ?? { rows: [] };
      return { rows: last.rows ?? [], rowCount: last.affectedRows ?? last.rows?.length ?? 0 };
    }
    const res = await pg.query(sql, params);
    return { rows: res.rows, rowCount: res.affectedRows ?? res.rows.length };
  };

  return {
    query: (sql, params) => {
      const result = tail.then(() => run(sql, params));
      tail = result.catch(() => {});
      return result;
    },
    async connect() {
      let release;
      const held = new Promise((resolve) => {
        release = resolve;
      });
      const previous = tail;
      tail = held;
      await previous;
      return {
        query: (sql, params) => run(sql, params),
        release: () => release(),
      };
    },
    async end() {
      await pg.close();
    },
  };
}

export async function createMemoryDatabase() {
  const pg = await PGlite.create();
  const pool = asPool(pg);
  await runMigrations(pool);
  return pool;
}

// The settings the application needs when it has no real database to describe.
export const memoryConfig = () => ({
  environment: 'test',
  host: '127.0.0.1',
  publicBaseUrl: 'http://app.example.test',
  companySecretKey: null,
  devStorageDir: null,
  db: {},
});

// A running application over the in-memory database. `config` can add or
// replace settings, and `extraDeps` is passed to createApp (for example a
// mocked document fetcher).
export async function startMemoryHarness({ config = {}, extraDeps = {} } = {}) {
  const pool = await createMemoryDatabase();
  const appConfig = { ...memoryConfig(), ...config };
  const server = createApp({ config: appConfig, pool, ...extraDeps }).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  async function raw(path, { method = 'GET', body, cookie, headers = {}, rawBody } = {}) {
    return fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
        ...headers,
      },
      body: rawBody ?? (body ? JSON.stringify(body) : undefined),
    });
  }

  async function api(path, options = {}) {
    const res = await raw(`/api${path}`, options);
    const text = await res.text();
    let parsed;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = text;
    }
    return { status: res.status, body: parsed };
  }

  async function signedIn(options) {
    const user = await createTestUser(pool, options);
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: user.email, password: user.password }),
    });
    return { ...user, cookie: res.headers.get('set-cookie').split(';')[0] };
  }

  const query = async (sql, params = []) => (await pool.query(sql, params)).rows;

  return {
    pool,
    baseUrl,
    api,
    raw,
    signedIn,
    query,
    async stop() {
      await new Promise((resolve) => server.close(resolve));
      await pool.end();
    },
  };
}
