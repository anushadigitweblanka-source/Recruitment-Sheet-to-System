import { recordAudit } from '../audit/audit.js';
import { verifyAgainstNothing, verifyPassword } from './passwords.js';
import { createSession, deleteSession, findSessionUser } from './sessions.js';

// After this many wrong passwords in a row, sign-in is paused for a while.
// The pause ends by itself; an account is never locked permanently.
export const MAX_FAILED_ATTEMPTS = 5;
export const LOCK_MINUTES = 15;

// The same message for every failure, so the answer never reveals whether an
// email exists, is deactivated or is temporarily paused.
export const LOGIN_FAILED_MESSAGE =
  'Sign-in failed. Check your email and password. After several failed attempts, sign-in is paused for a few minutes.';

export function normalizeEmail(email) {
  return String(email).trim().toLowerCase();
}

async function failLogin(db, { userId = null, reason }) {
  // The reason is recorded for administrators only. It is never sent back.
  await recordAudit(db, {
    actorUserId: userId,
    action: 'LOGIN_FAILED',
    entityType: userId ? 'users' : null,
    entityId: userId,
    details: { reason },
  });
  return { ok: false };
}

// Checks an email and password. Returns { ok: true, token, user } or { ok: false }.
export async function login(db, { email, password }) {
  const { rows } = await db.query(
    `SELECT u.id, u.is_active, c.password_hash,
            (c.locked_until IS NOT NULL AND c.locked_until > now()) AS is_locked
       FROM users u
       LEFT JOIN user_credentials c ON c.user_id = u.id
      WHERE u.email = $1`,
    [normalizeEmail(email)],
  );
  const account = rows[0];

  if (!account || !account.password_hash) {
    await verifyAgainstNothing(password);
    return failLogin(db, { reason: 'unknown_email' });
  }

  const passwordMatches = await verifyPassword(account.password_hash, password);

  // While sign-in is paused, even the correct password is refused.
  if (account.is_locked) {
    return failLogin(db, { userId: account.id, reason: 'locked' });
  }

  if (!passwordMatches) {
    await db.query(
      `UPDATE user_credentials
          SET failed_login_attempts =
                CASE WHEN failed_login_attempts + 1 >= $2 THEN 0 ELSE failed_login_attempts + 1 END,
              locked_until =
                CASE WHEN failed_login_attempts + 1 >= $2
                     THEN now() + make_interval(mins => $3)
                     ELSE locked_until END
        WHERE user_id = $1`,
      [account.id, MAX_FAILED_ATTEMPTS, LOCK_MINUTES],
    );
    return failLogin(db, { userId: account.id, reason: 'wrong_password' });
  }

  if (!account.is_active) {
    return failLogin(db, { userId: account.id, reason: 'inactive' });
  }

  await db.query(
    'UPDATE user_credentials SET failed_login_attempts = 0, locked_until = NULL WHERE user_id = $1',
    [account.id],
  );
  await db.query('UPDATE users SET last_login_at = now() WHERE id = $1', [account.id]);

  const token = await createSession(db, account.id);
  const user = await findSessionUser(db, token);
  await recordAudit(db, {
    actorUserId: account.id,
    action: 'LOGIN_SUCCESS',
    entityType: 'users',
    entityId: account.id,
  });

  return { ok: true, token, user };
}

export async function logout(db, { token, user }) {
  await deleteSession(db, token);
  if (user) {
    await recordAudit(db, {
      actorUserId: user.id,
      action: 'LOGOUT',
      entityType: 'users',
      entityId: user.id,
    });
  }
}
