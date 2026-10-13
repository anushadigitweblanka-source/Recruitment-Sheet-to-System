import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { runMigrations } from '../src/db/migrate.js';
import { requireAuth, requirePermission } from '../src/middleware/auth.js';
import { recordAudit } from '../src/modules/audit/audit.js';
import {
  MIN_PASSWORD_LENGTH,
  hashPassword,
  verifyPassword,
} from '../src/modules/auth/passwords.js';
import { createTestDatabase, createTestUser, randomPassword } from './helpers/testDb.js';

let db;

before(async () => {
  db = await createTestDatabase();
});

after(async () => {
  await db.cleanup();
});

describe('password hashing', () => {
  test('produces an Argon2id hash that does not contain the password', async () => {
    const password = randomPassword();
    const hash = await hashPassword(password);

    assert.match(hash, /^\$argon2id\$/);
    assert.ok(!hash.includes(password));
  });

  test('gives a different hash each time, because each has its own salt', async () => {
    const password = randomPassword();

    assert.notEqual(await hashPassword(password), await hashPassword(password));
  });

  test('accepts the right password and rejects a wrong one', async () => {
    const password = randomPassword();
    const hash = await hashPassword(password);

    assert.equal(await verifyPassword(hash, password), true);
    assert.equal(await verifyPassword(hash, randomPassword()), false);
  });

  test('refuses a password that is too short', async () => {
    await assert.rejects(hashPassword('x'.repeat(MIN_PASSWORD_LENGTH - 1)), /at least/);
  });

  test('never throws on a damaged hash; it simply does not match', async () => {
    assert.equal(await verifyPassword('not-a-hash', randomPassword()), false);
    assert.equal(await verifyPassword(null, randomPassword()), false);
  });
});

describe('migration 001', () => {
  test('creates exactly the identity tables and no recruitment tables', async () => {
    const { rows } = await db.pool.query(
      'SELECT tablename FROM pg_tables WHERE schemaname = $1 ORDER BY tablename',
      [db.schema],
    );

    assert.deepEqual(
      rows.map((row) => row.tablename),
      [
        'audit_log',
        'permissions',
        'role_permissions',
        'roles',
        'schema_migrations',
        'user_credentials',
        'user_sessions',
        'users',
      ],
    );
  });

  test('running the migrations again changes nothing', async () => {
    assert.deepEqual(await runMigrations(db.pool), []);
  });

  test('no table has a column for a readable password', async () => {
    const { rows } = await db.pool.query(
      `SELECT table_name, column_name FROM information_schema.columns
        WHERE table_schema = $1 AND column_name ~ 'password' AND column_name <> 'password_hash'
          AND column_name NOT IN ('password_changed_at', 'must_change_password')`,
      [db.schema],
    );

    assert.deepEqual(rows, []);
  });

  test('the Main User role exists and holds the salary permissions separately', async () => {
    const { rows } = await db.pool.query(
      `SELECT p.code FROM role_permissions rp
         JOIN roles r ON r.id = rp.role_id
         JOIN permissions p ON p.id = rp.permission_id
        WHERE r.code = 'main_user' ORDER BY p.code`,
    );
    const codes = rows.map((row) => row.code);

    assert.ok(codes.includes('salary.view'));
    assert.ok(codes.includes('salary.edit'));
    assert.ok(codes.includes('candidates.view'));
  });
});

describe('database rules', () => {
  test('a plain password cannot be stored as a hash', async () => {
    const user = await createTestUser(db.pool);

    await assert.rejects(
      db.pool.query('UPDATE user_credentials SET password_hash = $1 WHERE user_id = $2', [
        randomPassword(),
        user.id,
      ]),
      /user_credentials_hash_is_argon2id/,
    );
  });

  test('two users cannot share an email', async () => {
    const user = await createTestUser(db.pool);

    await assert.rejects(
      db.pool.query(
        `INSERT INTO users (email, full_name, role_id)
         VALUES ($1, 'Duplicate', (SELECT id FROM roles WHERE code = 'main_user'))`,
        [user.email],
      ),
      /users_email_key/,
    );
  });

  test('an email must be stored trimmed and in lower case', async () => {
    await assert.rejects(
      db.pool.query(
        `INSERT INTO users (email, full_name, role_id)
         VALUES ('Mixed.Case@Example.Test', 'Someone', (SELECT id FROM roles WHERE code = 'main_user'))`,
      ),
      /users_email_normalized/,
    );
  });

  test('a user must have a role that exists', async () => {
    await assert.rejects(
      db.pool.query(
        `INSERT INTO users (email, full_name, role_id) VALUES ('norole@example.test', 'Someone', 999999)`,
      ),
      /users_role_id_fkey/,
    );
  });

  test('deleting a user removes their credentials and sessions', async () => {
    const user = await createTestUser(db.pool);
    await db.pool.query('DELETE FROM users WHERE id = $1', [user.id]);

    const { rows } = await db.pool.query(
      'SELECT count(*)::int AS left_over FROM user_credentials WHERE user_id = $1',
      [user.id],
    );
    assert.equal(rows[0].left_over, 0);
  });
});

describe('audit log safety', () => {
  test('refuses to store a password, hash, token or salary', async () => {
    for (const details of [
      { password: 'x' },
      { passwordHash: 'x' },
      { sessionToken: 'x' },
      { nested: { salary_lkr: 1 } },
    ]) {
      await assert.rejects(recordAudit(db.pool, { action: 'TEST', details }), /must not contain/);
    }
  });

  test('stores an ordinary entry', async () => {
    await recordAudit(db.pool, { action: 'TEST_ENTRY', details: { reason: 'example' } });

    const { rows } = await db.pool.query(
      `SELECT details FROM audit_log WHERE action = 'TEST_ENTRY'`,
    );
    assert.deepEqual(rows[0].details, { reason: 'example' });
  });
});

describe('permission checks', () => {
  function run(middleware, user) {
    const result = { status: null, body: null, passed: false };
    const res = {
      status(code) {
        result.status = code;
        return this;
      },
      json(body) {
        result.body = body;
        return this;
      },
    };
    middleware({ user }, res, () => {
      result.passed = true;
    });
    return result;
  }

  test('requireAuth lets a signed-in user through and stops everyone else', () => {
    assert.equal(run(requireAuth, { permissions: [] }).passed, true);
    assert.equal(run(requireAuth, undefined).status, 401);
  });

  test('requirePermission needs the exact permission', () => {
    const check = requirePermission('salary.view');

    assert.equal(run(check, { permissions: ['salary.view'] }).passed, true);
    assert.equal(run(check, { permissions: ['candidates.view'] }).status, 403);
    assert.equal(run(check, undefined).status, 401);
  });
});
