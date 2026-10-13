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
export async function createTestDatabase() {
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

export async function createTestUser(pool, { isActive = true } = {}) {
  const email = `user-${randomBytes(5).toString('hex')}@example.test`;
  const password = randomPassword();

  const { rows } = await pool.query(
    `INSERT INTO users (email, full_name, role_id, is_active)
     VALUES ($1, 'Test User', (SELECT id FROM roles WHERE code = 'main_user'), $2)
     RETURNING id`,
    [email, isActive],
  );
  const id = Number(rows[0].id);
  await pool.query('INSERT INTO user_credentials (user_id, password_hash) VALUES ($1, $2)', [
    id,
    await hashPassword(password),
  ]);

  return { id, email, password };
}
