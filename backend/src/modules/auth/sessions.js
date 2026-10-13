import { createHash, randomBytes } from 'node:crypto';

export const SESSION_COOKIE = 'rs_session';
// A session ends after this long without a request...
export const SESSION_IDLE_MINUTES = 60;
// ...and in any case this long after sign-in.
export const SESSION_MAX_HOURS = 8;

// The browser holds a random token. The database holds only its SHA-256 hash,
// so reading the sessions table does not let anyone sign in.
export function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

export function sessionCookieOptions(config) {
  return {
    httpOnly: true, // not readable by scripts in the page
    sameSite: 'lax', // not sent on requests made by other sites
    secure: config.environment === 'production', // HTTPS only in production
    path: '/',
    maxAge: SESSION_MAX_HOURS * 60 * 60 * 1000,
  };
}

export function readSessionToken(req) {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator > -1 && part.slice(0, separator).trim() === SESSION_COOKIE) {
      return part.slice(separator + 1).trim() || null;
    }
  }
  return null;
}

export async function createSession(db, userId) {
  const token = randomBytes(32).toString('base64url');
  // Old, expired rows for this user are cleared out at each sign-in.
  await db.query('DELETE FROM user_sessions WHERE user_id = $1 AND expires_at <= now()', [userId]);
  await db.query(
    `INSERT INTO user_sessions (user_id, token_hash, expires_at)
     VALUES ($1, $2, now() + make_interval(hours => $3))`,
    [userId, hashToken(token), SESSION_MAX_HOURS],
  );
  return token;
}

// Returns the signed-in user for a token, or null if the session is missing,
// expired, idle for too long, or the user has been deactivated.
export async function findSessionUser(db, token) {
  const { rows } = await db.query(
    `SELECT s.id AS session_id, u.id, u.email, u.full_name,
            r.code AS role_code, r.name AS role_name,
            COALESCE(c.must_change_password, false) AS must_change_password,
            COALESCE(
              (SELECT array_agg(p.code ORDER BY p.code)
                 FROM role_permissions rp
                 JOIN permissions p ON p.id = rp.permission_id
                WHERE rp.role_id = r.id),
              '{}'
            ) AS permissions
       FROM user_sessions s
       JOIN users u ON u.id = s.user_id
       JOIN roles r ON r.id = u.role_id
       LEFT JOIN user_credentials c ON c.user_id = u.id
      WHERE s.token_hash = $1
        AND s.expires_at > now()
        AND s.last_seen_at > now() - make_interval(mins => $2)
        AND u.is_active`,
    [hashToken(token), SESSION_IDLE_MINUTES],
  );
  if (rows.length === 0) return null;

  // Keeps the idle timer fresh, at most one write per minute per session.
  await db.query(
    `UPDATE user_sessions SET last_seen_at = now()
      WHERE id = $1 AND last_seen_at < now() - interval '1 minute'`,
    [rows[0].session_id],
  );
  return toPublicUser(rows[0]);
}

export async function deleteSession(db, token) {
  await db.query('DELETE FROM user_sessions WHERE token_hash = $1', [hashToken(token)]);
}

// The only shape of a user that is ever sent to the browser.
export function toPublicUser(row) {
  return {
    id: Number(row.id),
    email: row.email,
    fullName: row.full_name,
    role: { code: row.role_code, name: row.role_name },
    permissions: row.permissions,
    mustChangePassword: row.must_change_password,
  };
}
