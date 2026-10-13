import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { createApp } from '../src/app.js';
import {
  LOCK_MINUTES,
  LOGIN_FAILED_MESSAGE,
  MAX_FAILED_ATTEMPTS,
} from '../src/modules/auth/auth.service.js';
import { SESSION_COOKIE, sessionCookieOptions } from '../src/modules/auth/sessions.js';
import { createTestDatabase, createTestUser, randomPassword } from './helpers/testDb.js';

// Integration tests: a real server and real tables, in a throwaway schema.

let db;
let server;
let baseUrl;

// Everything the server answered or logged, checked at the end for leaks.
const responseBodies = [];
const logLines = [];
const usedPasswords = [];
const originalConsole = { log: console.log, error: console.error };

before(async () => {
  console.log = (...args) => logLines.push(args.join(' '));
  console.error = (...args) => logLines.push(args.join(' '));

  db = await createTestDatabase();
  server = createApp({ config: db.config, pool: db.pool }).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await db.cleanup();
  Object.assign(console, originalConsole);
});

async function api(path, { method = 'GET', body, cookie } = {}) {
  const res = await fetch(`${baseUrl}/api${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  responseBodies.push(text);
  const setCookie = res.headers.get('set-cookie');
  return {
    status: res.status,
    headers: res.headers,
    body: text ? JSON.parse(text) : null,
    setCookie,
    // The "name=value" part, ready to send back as a Cookie header.
    cookie: setCookie ? setCookie.split(';')[0] : null,
  };
}

async function newUser(options) {
  const user = await createTestUser(db.pool, options);
  usedPasswords.push(user.password);
  return user;
}

const signIn = (user) =>
  api('/auth/login', { method: 'POST', body: { email: user.email, password: user.password } });

describe('signing in', () => {
  test('the correct password signs in and returns the user', async () => {
    const user = await newUser();
    const res = await signIn(user);

    assert.equal(res.status, 200);
    assert.equal(res.body.user.email, user.email);
    assert.equal(res.body.user.fullName, 'Test User');
    assert.equal(res.body.user.role.code, 'main_user');
    assert.ok(res.body.user.permissions.includes('candidates.view'));
  });

  test('the session cookie is HTTP-only and SameSite, with an expiry', async () => {
    const res = await signIn(await newUser());

    assert.match(res.setCookie, new RegExp(`^${SESSION_COOKIE}=`));
    assert.match(res.setCookie, /HttpOnly/i);
    assert.match(res.setCookie, /SameSite=Lax/i);
    assert.match(res.setCookie, /Max-Age=\d+/i);
  });

  test('the cookie is marked Secure in production only', () => {
    assert.equal(sessionCookieOptions({ environment: 'production' }).secure, true);
    assert.equal(sessionCookieOptions({ environment: 'development' }).secure, false);
  });

  test('the email is matched whatever its case or surrounding spaces', async () => {
    const user = await newUser();
    const res = await api('/auth/login', {
      method: 'POST',
      body: { email: `  ${user.email.toUpperCase()} `, password: user.password },
    });

    assert.equal(res.status, 200);
  });

  test('a wrong password is rejected with the generic message', async () => {
    const user = await newUser();
    const wrong = randomPassword();
    usedPasswords.push(wrong);
    const res = await api('/auth/login', {
      method: 'POST',
      body: { email: user.email, password: wrong },
    });

    assert.equal(res.status, 401);
    assert.deepEqual(res.body, { error: LOGIN_FAILED_MESSAGE });
    assert.equal(res.setCookie, null);
  });

  test('an unknown email gets exactly the same answer as a wrong password', async () => {
    const user = await newUser();
    const wrong = randomPassword();
    usedPasswords.push(wrong);

    const wrongPassword = await api('/auth/login', {
      method: 'POST',
      body: { email: user.email, password: wrong },
    });
    const unknownEmail = await api('/auth/login', {
      method: 'POST',
      body: { email: 'nobody@example.test', password: wrong },
    });

    assert.equal(unknownEmail.status, wrongPassword.status);
    assert.deepEqual(unknownEmail.body, wrongPassword.body);
  });

  test('a deactivated user cannot sign in, and gets the same generic answer', async () => {
    const user = await newUser({ isActive: false });
    const res = await signIn(user);

    assert.equal(res.status, 401);
    assert.deepEqual(res.body, { error: LOGIN_FAILED_MESSAGE });
  });

  test('missing fields are refused', async () => {
    const res = await api('/auth/login', { method: 'POST', body: { email: 'a@example.test' } });

    assert.equal(res.status, 400);
  });
});

describe('the current user', () => {
  test('GET /auth/me returns the user when signed in', async () => {
    const user = await newUser();
    const { cookie } = await signIn(user);
    const res = await api('/auth/me', { cookie });

    assert.equal(res.status, 200);
    assert.equal(res.body.user.email, user.email);
  });

  test('GET /auth/me is refused when not signed in', async () => {
    const res = await api('/auth/me');

    assert.equal(res.status, 401);
  });

  test('a made-up cookie is refused', async () => {
    const res = await api('/auth/me', { cookie: `${SESSION_COOKIE}=not-a-real-session` });

    assert.equal(res.status, 401);
  });

  test('API answers are never cached by the browser', async () => {
    const { cookie } = await signIn(await newUser());
    const res = await api('/auth/me', { cookie });

    assert.equal(res.headers.get('cache-control'), 'no-store');
  });

  test('the user sent to the browser has no password or hash fields', async () => {
    const { cookie } = await signIn(await newUser());
    const res = await api('/auth/me', { cookie });

    assert.deepEqual(Object.keys(res.body.user).sort(), [
      'email',
      'fullName',
      'id',
      'mustChangePassword',
      'permissions',
      'role',
    ]);
  });
});

describe('signing out', () => {
  test('logout ends the session on the server', async () => {
    const user = await newUser();
    const { cookie } = await signIn(user);

    const logout = await api('/auth/logout', { method: 'POST', cookie });
    assert.equal(logout.status, 204);
    assert.match(logout.setCookie, new RegExp(`^${SESSION_COOKIE}=;`));

    // The old cookie no longer works, even if the browser kept it.
    const afterLogout = await api('/auth/me', { cookie });
    assert.equal(afterLogout.status, 401);

    const sessions = await db.pool.query('SELECT 1 FROM user_sessions WHERE user_id = $1', [
      user.id,
    ]);
    assert.equal(sessions.rowCount, 0);
  });

  test('logout without a session still answers cleanly', async () => {
    const res = await api('/auth/logout', { method: 'POST' });

    assert.equal(res.status, 204);
  });
});

describe('sessions end by themselves', () => {
  test('after the maximum lifetime', async () => {
    const user = await newUser();
    const { cookie } = await signIn(user);
    await db.pool.query(
      `UPDATE user_sessions
          SET created_at = now() - interval '9 hours', expires_at = now() - interval '1 hour'
        WHERE user_id = $1`,
      [user.id],
    );

    assert.equal((await api('/auth/me', { cookie })).status, 401);
  });

  test('after being idle for too long', async () => {
    const user = await newUser();
    const { cookie } = await signIn(user);
    await db.pool.query(
      `UPDATE user_sessions SET last_seen_at = now() - interval '2 hours' WHERE user_id = $1`,
      [user.id],
    );

    assert.equal((await api('/auth/me', { cookie })).status, 401);
  });

  test('when the user is deactivated while signed in', async () => {
    const user = await newUser();
    const { cookie } = await signIn(user);
    await db.pool.query('UPDATE users SET is_active = false WHERE id = $1', [user.id]);

    assert.equal((await api('/auth/me', { cookie })).status, 401);
  });
});

describe('protected routes', () => {
  test('any other API route refuses a visitor who is not signed in', async () => {
    const res = await api('/anything-else');

    assert.equal(res.status, 401);
    assert.deepEqual(res.body, { error: 'Not signed in.' });
  });

  test('a signed-in user gets past the sign-in check', async () => {
    const { cookie } = await signIn(await newUser());
    const res = await api('/anything-else', { cookie });

    // 404, not 401: the user is allowed in, there is simply nothing at this address yet.
    assert.equal(res.status, 404);
  });

  test('the health check stays open', async () => {
    assert.equal((await api('/health')).status, 200);
  });
});

describe('repeated failed sign-ins', () => {
  test('pause sign-in for a while, then allow it again', async () => {
    const user = await newUser();
    const wrong = randomPassword();
    usedPasswords.push(wrong);

    for (let attempt = 0; attempt < MAX_FAILED_ATTEMPTS; attempt += 1) {
      const res = await api('/auth/login', {
        method: 'POST',
        body: { email: user.email, password: wrong },
      });
      assert.equal(res.status, 401);
    }

    // Paused: even the correct password is refused, with the same generic answer.
    const whilePaused = await signIn(user);
    assert.equal(whilePaused.status, 401);
    assert.deepEqual(whilePaused.body, { error: LOGIN_FAILED_MESSAGE });

    const { rows } = await db.pool.query(
      `SELECT locked_until > now() AS is_locked,
              locked_until <= now() + make_interval(mins => $2) AS ends_on_time
         FROM user_credentials WHERE user_id = $1`,
      [user.id, LOCK_MINUTES],
    );
    assert.deepEqual(rows[0], { is_locked: true, ends_on_time: true });

    // The pause is temporary. Once it has passed, the correct password works.
    await db.pool.query(
      `UPDATE user_credentials SET locked_until = now() - interval '1 second' WHERE user_id = $1`,
      [user.id],
    );
    assert.equal((await signIn(user)).status, 200);
  });

  test('a successful sign-in clears the count of failures', async () => {
    const user = await newUser();
    const wrong = randomPassword();
    usedPasswords.push(wrong);

    await api('/auth/login', { method: 'POST', body: { email: user.email, password: wrong } });
    await signIn(user);

    const { rows } = await db.pool.query(
      'SELECT failed_login_attempts FROM user_credentials WHERE user_id = $1',
      [user.id],
    );
    assert.equal(rows[0].failed_login_attempts, 0);
  });
});

describe('audit log', () => {
  test('records sign-in, failed sign-in and sign-out for the user', async () => {
    const user = await newUser();
    const wrong = randomPassword();
    usedPasswords.push(wrong);

    await api('/auth/login', { method: 'POST', body: { email: user.email, password: wrong } });
    const { cookie } = await signIn(user);
    await api('/auth/logout', { method: 'POST', cookie });

    const { rows } = await db.pool.query(
      'SELECT action FROM audit_log WHERE actor_user_id = $1 ORDER BY id',
      [user.id],
    );
    assert.deepEqual(
      rows.map((row) => row.action),
      ['LOGIN_FAILED', 'LOGIN_SUCCESS', 'LOGOUT'],
    );
  });

  test('records a failed sign-in for an unknown email without storing the email', async () => {
    const address = 'someone-unknown@example.test';
    await api('/auth/login', {
      method: 'POST',
      body: { email: address, password: randomPassword() },
    });

    const { rows } = await db.pool.query(
      `SELECT count(*)::int AS unknown_email_rows,
              count(*) FILTER (WHERE audit_log::text LIKE '%' || $1 || '%')::int AS rows_with_address
         FROM audit_log
        WHERE action = 'LOGIN_FAILED' AND details->>'reason' = 'unknown_email'`,
      [address],
    );
    assert.ok(rows[0].unknown_email_rows >= 1);
    assert.equal(rows[0].rows_with_address, 0);
  });
});

describe('nothing secret leaks', () => {
  // Runs last: checks everything the tests above caused the server to say.
  test('no password or hash appears in any response, log line or audit row', async () => {
    assert.ok(usedPasswords.length > 10);
    assert.ok(responseBodies.length > 20);

    const audit = await db.pool.query('SELECT audit_log::text AS row FROM audit_log');
    const everything = [...responseBodies, ...logLines, ...audit.rows.map((row) => row.row)].join(
      '\n',
    );

    for (const password of usedPasswords) {
      assert.ok(!everything.includes(password), 'a password was exposed');
    }
    assert.doesNotMatch(everything, /\$argon2/, 'a password hash was exposed');
    assert.doesNotMatch(responseBodies.join('\n'), /password_hash|passwordHash/);
  });

  test('no session token is stored in readable form', async () => {
    const { cookie } = await signIn(await newUser());
    const token = cookie.split('=')[1];

    const { rows } = await db.pool.query(
      `SELECT count(*)::int AS found FROM user_sessions WHERE user_sessions::text LIKE '%' || $1 || '%'`,
      [token],
    );
    assert.equal(rows[0].found, 0);
  });
});
