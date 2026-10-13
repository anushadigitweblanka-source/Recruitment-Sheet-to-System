import { findSessionUser, readSessionToken } from '../modules/auth/sessions.js';

// Looks up the signed-in user from the session cookie and puts it on req.user.
// A request with no valid session simply has no req.user.
export function attachUser({ pool }) {
  return async (req, res, next) => {
    const token = readSessionToken(req);
    if (token) {
      req.user = (await findSessionUser(pool, token)) ?? undefined;
    }
    next();
  };
}

// Authentication: is anyone signed in?
export function requireAuth(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Not signed in.' });
  }
  next();
}

// Authorization: may this user do this? Use on any route that needs a
// specific permission, for example requirePermission('candidates.edit').
// This check runs on the server; hiding a button in the page is not enough.
export function requirePermission(code) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Not signed in.' });
    }
    if (!req.user.permissions.includes(code)) {
      return res.status(403).json({ error: 'You do not have permission to do this.' });
    }
    next();
  };
}
