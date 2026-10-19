// Resets ONLY the password of the one development account, dev.admin@example.com.
// Run it yourself, in your own terminal, from the project root:
//
//   node backend/scripts/reset-dev-admin-password.js
//
// Unlike create-dev-admin it never touches the name, role or active flag, and it
// does not read the password from .env: it asks for it with a hidden prompt, so
// the password is never printed, logged, stored in a file or put in a command.
// It writes the password hash (argon2id), clears the failed-login count and
// lock, and signs this one account out everywhere, as a password change does.
import { loadConfig, loadEnvFile } from '../src/config/env.js';
import { createPool } from '../src/db/pool.js';
import { recordAudit } from '../src/modules/audit/audit.js';
import { hashPassword } from '../src/modules/auth/passwords.js';
import { assertDevelopmentDatabase } from './devSafety.js';

const TARGET_EMAIL = 'dev.admin@example.com';

// Reads one line from the terminal without echoing it.
function askHidden(question) {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY) {
      reject(
        new Error('This needs an interactive terminal, so the password can be typed privately.'),
      );
      return;
    }
    process.stdout.write(question);
    let text = '';
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    const onData = (chunk) => {
      for (const char of chunk) {
        if (char === '\r' || char === '\n') {
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdin.off('data', onData);
          process.stdout.write('\n');
          resolve(text);
          return;
        }
        if (char === '\u0003') {
          process.stdin.setRawMode(false);
          reject(new Error('Cancelled. Nothing was changed.'));
          return;
        }
        if (char === '\u007f' || char === '\b') text = text.slice(0, -1);
        else text += char;
      }
    };
    process.stdin.on('data', onData);
  });
}

let pool;
try {
  loadEnvFile();
  const config = loadConfig();
  assertDevelopmentDatabase(config);
  console.log(`Database: ${config.db.database}`);

  pool = createPool(config.db);
  const found = await pool.query('SELECT id, is_active FROM users WHERE email = $1', [
    TARGET_EMAIL,
  ]);
  if (found.rowCount === 0) throw new Error(`No account ${TARGET_EMAIL}. Nothing was changed.`);
  if (!found.rows[0].is_active) throw new Error('The account is not active. Nothing was changed.');
  const userId = found.rows[0].id;
  console.log(`Target account: ${TARGET_EMAIL}`);

  const first = await askHidden('New password (hidden, at least 12 characters): ');
  const second = await askHidden('Type it again (hidden): ');
  if (first !== second) throw new Error('The two entries differ. Nothing was changed.');
  const passwordHash = await hashPassword(first); // throws if too short or too long

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const updated = await client.query(
      `UPDATE user_credentials
          SET password_hash = $2, password_changed_at = now(), must_change_password = false,
              failed_login_attempts = 0, locked_until = NULL
        WHERE user_id = $1`,
      [userId, passwordHash],
    );
    if (updated.rowCount !== 1) throw new Error('Expected to update exactly one account.');
    await client.query('DELETE FROM user_sessions WHERE user_id = $1', [userId]);
    await recordAudit(client, {
      action: 'USER_PASSWORD_RESET',
      entityType: 'users',
      entityId: userId,
      details: { via: 'reset-dev-admin-password script' },
    });
    await client.query('COMMIT');
    console.log(`Password updated for ${TARGET_EMAIL}. Sign in with the password you just typed.`);
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
