import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import {
  MIN_SERVER_VERSION_NUM,
  classifyHost,
  explainConnectionError,
  formatReport,
  inspectDatabase,
} from '../scripts/dbCheck.js';
import { createTestDatabase } from './helpers/testDb.js';

// The read-only connection checker, run against a throwaway schema. Every host
// name and password below is made up.

const run = promisify(execFile);
const CLI = fileURLToPath(new URL('../scripts/check-db-connection.js', import.meta.url));

describe('classifyHost', () => {
  test('tells this computer, a private network and a remote server apart', () => {
    for (const host of ['localhost', '127.0.0.1', '::1', '0.0.0.0']) {
      assert.equal(classifyHost(host), 'local', host);
    }
    for (const host of [
      '10.1.2.3',
      '192.168.0.9',
      '172.16.5.5',
      '172.31.0.1',
      'dbserver',
      'db.corp',
      'pg.internal',
    ]) {
      assert.equal(classifyHost(host), 'private-network', host);
    }
    for (const host of ['db.example.com', '203.0.113.7', 'pg.example.org']) {
      assert.equal(classifyHost(host), 'remote', host);
    }
    assert.equal(classifyHost(''), 'unknown');
    assert.equal(classifyHost('172.32.0.1'), 'remote');
  });
});

describe('explainConnectionError', () => {
  test('names the problem without echoing the server address', () => {
    const err = Object.assign(new Error('connect ECONNREFUSED 203.0.113.7:5432'), {
      code: 'ECONNREFUSED',
    });
    const text = explainConnectionError(err);
    assert.match(text, /refused/);
    assert.equal(text.includes('203.0.113.7'), false);
    assert.match(
      explainConnectionError(Object.assign(new Error('x'), { code: 'SELF_SIGNED_CERT_IN_CHAIN' })),
      /does not trust/,
    );
    assert.match(explainConnectionError(Object.assign(new Error('x'), { code: '28P01' })), /login/);
  });
});

describe('inspectDatabase (throwaway schema)', () => {
  let db;
  let client;
  before(async () => {
    db = await createTestDatabase();
    client = await db.pool.connect();
  });
  after(async () => {
    client.release();
    await db.cleanup();
  });

  test('reports version, tables, migrations and privileges, and changes nothing', async () => {
    const before = (await db.pool.query('SELECT count(*)::int AS n FROM audit_log')).rows[0].n;
    const report = await inspectDatabase(client);

    assert.ok(report.versionNum >= MIN_SERVER_VERSION_NUM);
    assert.equal(report.versionOk, true);
    assert.deepEqual(report.missingTables, []);
    assert.deepEqual(report.unappliedMigrations, []);
    assert.equal(report.appliedMigrations, 15);
    assert.equal(typeof report.encrypted, 'boolean');
    // The test login owns the tables, so it is not a read-only login.
    assert.equal(report.readOnlyLogin, false);
    assert.equal(report.appCanWork, true);
    assert.equal(report.privileges.user_sessions.insert, true);

    const after = (await db.pool.query('SELECT count(*)::int AS n FROM audit_log')).rows[0].n;
    assert.equal(after, before);
  });

  test('notices a migration that has not been applied', async () => {
    await db.pool.query(
      `DELETE FROM schema_migrations WHERE filename = '015_historical_interviews.sql'`,
    );
    const report = await inspectDatabase(client);
    assert.deepEqual(report.unappliedMigrations, ['015_historical_interviews.sql']);
  });

  test('refuses to write: the inspection runs in a read-only transaction', async () => {
    await client.query('BEGIN READ ONLY');
    await assert.rejects(
      client.query(`INSERT INTO settings (key, value) VALUES ('probe', '1')`),
      /read-only transaction/,
    );
    await client.query('ROLLBACK');
  });

  test('the printed report has no host, user or password in it', async () => {
    const report = await inspectDatabase(client);
    const text = formatReport({
      hostClass: 'remote',
      tlsMode: 'on, certificate verified',
      report,
    }).join('\n');
    assert.match(text, /PostgreSQL version/);
    assert.match(text, /Application can sign in and work/);
    assert.equal(text.includes(db.config.db.user), false);
    assert.equal(text.includes(db.config.db.password), false);
    assert.equal(text.includes(db.config.db.host), false);
  });
});

describe('the check command', () => {
  test('on an unreachable server it explains the failure and prints no secret', async () => {
    const env = {
      PATH: process.env.PATH,
      SystemRoot: process.env.SystemRoot,
      DB_HOST: '127.0.0.1',
      DB_PORT: '1',
      DB_NAME: 'fictional_db',
      DB_USER: 'fictional_user',
      DB_PASSWORD: 'not-a-real-password',
    };
    await assert.rejects(run(process.execPath, [CLI], { env }), (err) => {
      assert.equal(err.code, 1);
      assert.match(err.stdout, /Host location: local/);
      assert.match(err.stderr, /refused|timed out/);
      for (const secret of ['not-a-real-password', 'fictional_user']) {
        assert.equal((err.stdout + err.stderr).includes(secret), false);
      }
      return true;
    });
  });
});
