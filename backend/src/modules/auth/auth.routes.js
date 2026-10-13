import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { LOGIN_FAILED_MESSAGE, login, logout } from './auth.service.js';
import { MAX_PASSWORD_LENGTH } from './passwords.js';
import { SESSION_COOKIE, readSessionToken, sessionCookieOptions } from './sessions.js';

const MAX_EMAIL_LENGTH = 254;

export function authRouter({ config, pool }) {
  const router = Router();
  const cookieOptions = sessionCookieOptions(config);
  // Clearing a cookie needs the same settings it was set with, minus its lifetime.
  const clearCookieOptions = { ...cookieOptions, maxAge: undefined };

  router.post('/login', async (req, res) => {
    const { email, password } = req.body ?? {};

    if (typeof email !== 'string' || typeof password !== 'string' || !email.trim() || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }
    // Over-long input is refused with the generic message, without hashing it.
    if (email.length > MAX_EMAIL_LENGTH || password.length > MAX_PASSWORD_LENGTH) {
      return res.status(401).json({ error: LOGIN_FAILED_MESSAGE });
    }

    const result = await login(pool, { email, password });
    if (!result.ok) {
      return res.status(401).json({ error: LOGIN_FAILED_MESSAGE });
    }

    res.cookie(SESSION_COOKIE, result.token, cookieOptions);
    res.json({ user: result.user });
  });

  router.post('/logout', async (req, res) => {
    const token = readSessionToken(req);
    if (token) {
      await logout(pool, { token, user: req.user });
    }
    res.clearCookie(SESSION_COOKIE, clearCookieOptions);
    res.status(204).end();
  });

  router.get('/me', requireAuth, (req, res) => {
    res.json({ user: req.user });
  });

  return router;
}
