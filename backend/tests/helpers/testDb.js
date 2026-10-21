import { randomBytes } from 'node:crypto';
import { loadConfig, loadEnvFile } from '../../src/config/env.js';
import { runMigrations } from '../../src/db/migrate.js';
import { createPool } from '../../src/db/pool.js';
import { hashPassword } from '../../src/modules/auth/passwords.js';

// Builds a private, throwaway copy of the database tables for one test file.
//
// The tables are created in their own schema (for example "test_3fa9c1d2")
// inside the development database, by running the real migrations. The real
// tables in the "public" schema are never read or written, and the schema is
// dropped again by cleanup().
// With TEST_DB=memory the same tables are built in an in-memory PostgreSQL
// (PGlite) instead, so the whole suite can run without any database server.
export async function createTestDatabase() {
  if (process.env.TEST_DB === 'memory') {
    const { createMemoryDatabase, memoryConfig } = await import('./memoryDb.js');
    const pool = await createMemoryDatabase();
    return { config: memoryConfig(), pool, schema: null, cleanup: () => pool.end() };
  }

  loadEnvFile();
  const config = loadConfig();
  const schema = `test_${randomBytes(6).toString('hex')}`;

  const adminPool = createPool(config.db);
  await adminPool.query(`CREATE SCHEMA ${schema}`);

  const pool = createPool({ ...config.db, schema });
  await runMigrations(pool);

  return {
    config,
    pool,
    schema,
    async cleanup() {
      await pool.end();
      await adminPool.query(`DROP SCHEMA ${schema} CASCADE`);
      await adminPool.end();
    },
  };
}

// A password made up at run time, so no password is written in the test code.
export function randomPassword() {
  return `pw-${randomBytes(12).toString('base64url')}`;
}

// Adds a role holding exactly the given permissions, for permission tests.
export async function createTestRole(pool, code, permissions = []) {
  await pool.query('INSERT INTO roles (code, name) VALUES ($1, $1)', [code]);
  await pool.query(
    `INSERT INTO role_permissions (role_id, permission_id)
     SELECT r.id, p.id FROM roles r, permissions p WHERE r.code = $1 AND p.code = ANY($2)`,
    [code, permissions],
  );
}

export async function createTestUser(pool, { isActive = true, roleCode = 'main_user' } = {}) {
  const email = `user-${randomBytes(5).toString('hex')}@example.test`;
  const password = randomPassword();

  const { rows } = await pool.query(
    `INSERT INTO users (email, full_name, role_id, is_active)
     VALUES ($1, 'Test User', (SELECT id FROM roles WHERE code = $3), $2)
     RETURNING id`,
    [email, isActive, roleCode],
  );
  const id = Number(rows[0].id);
  await pool.query('INSERT INTO user_credentials (user_id, password_hash) VALUES ($1, $2)', [
    id,
    await hashPassword(password),
  ]);

  return { id, email, password };
}
