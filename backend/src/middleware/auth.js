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

// Authorization when any one of several permissions is enough, for example a
// screen both HR (all candidates) and a Team Lead (own team) may open.
export function requireAnyPermission(...codes) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Not signed in.' });
    }
    if (!codes.some((code) => req.user.permissions.includes(code))) {
      return res.status(403).json({ error: 'You do not have permission to do this.' });
    }
    next();
  };
}

// A user who holds candidates.view sees every candidate. Anyone else who
// reached a candidate screen holds candidates.view_team and sees only the
// candidates of the team they lead. Returns the scope to apply, or null.
export function teamScopeFor(user) {
  if (user.permissions.includes('candidates.view')) return null;
  return { userId: user.id };
}
