// Creates or updates the one development sign-in account.
// Run from the project root with: npm run db:create-dev-admin
//
// Reads DEV_ADMIN_EMAIL, DEV_ADMIN_NAME and DEV_ADMIN_PASSWORD from .env.
// The password is hashed before it is stored and is never printed.
import { loadConfig, loadEnvFile } from '../src/config/env.js';
import { createPool } from '../src/db/pool.js';
import { recordAudit } from '../src/modules/audit/audit.js';
import { normalizeEmail } from '../src/modules/auth/auth.service.js';
import { hashPassword } from '../src/modules/auth/passwords.js';
import { assertDevelopmentDatabase } from './devSafety.js';

const DEV_ROLE = 'main_user';

function readSettings(env) {
  const missing = ['DEV_ADMIN_EMAIL', 'DEV_ADMIN_NAME', 'DEV_ADMIN_PASSWORD'].filter(
    (name) => !env[name],
  );
  if (missing.length > 0) {
    throw new Error(`Missing in .env: ${missing.join(', ')}`);
  }
  if (env.DEV_ADMIN_PASSWORD === 'CHANGE_ME') {
    throw new Error(
      'DEV_ADMIN_PASSWORD is still the placeholder. Choose a password in .env first.',
    );
  }
  return {
    email: normalizeEmail(env.DEV_ADMIN_EMAIL),
    fullName: env.DEV_ADMIN_NAME.trim(),
    password: env.DEV_ADMIN_PASSWORD,
  };
}

let pool;
try {
  loadEnvFile();
  const config = loadConfig();
  assertDevelopmentDatabase(config);
  const settings = readSettings(process.env);
  // Throws with a clear message if the password is too short or too long.
  const passwordHash = await hashPassword(settings.password);

  pool = createPool(config.db);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const role = await client.query('SELECT id FROM roles WHERE code = $1', [DEV_ROLE]);
    if (role.rowCount === 0) throw new Error('Role not found. Run "npm run db:migrate" first.');

    const user = await client.query(
      `INSERT INTO users (email, full_name, role_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (email) DO UPDATE
         SET full_name = EXCLUDED.full_name, role_id = EXCLUDED.role_id,
             is_active = true, updated_at = now()
       RETURNING id, (xmax = 0) AS created`,
      [settings.email, settings.fullName, role.rows[0].id],
    );
    const { id: userId, created } = user.rows[0];

    await client.query(
      `INSERT INTO user_credentials (user_id, password_hash)
       VALUES ($1, $2)
       ON CONFLICT (user_id) DO UPDATE
         SET password_hash = EXCLUDED.password_hash, password_changed_at = now(),
             must_change_password = false, failed_login_attempts = 0, locked_until = NULL`,
      [userId, passwordHash],
    );
    // A changed password signs the account out everywhere.
    await client.query('DELETE FROM user_sessions WHERE user_id = $1', [userId]);

    await recordAudit(client, {
      action: created ? 'DEV_ADMIN_CREATED' : 'DEV_ADMIN_UPDATED',
      entityType: 'users',
      entityId: userId,
    });

    await client.query('COMMIT');
    console.log(
      `Development account ${created ? 'created' : 'updated'}: ${settings.email} (Main User)`,
    );
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
} finally {
  await pool?.end();
}
