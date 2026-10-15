import { Router } from 'express';
import { listAlerts, markAllRead, markRead, parseLimit } from './inbox.js';

// A signed-in user's own in-app alerts. Mounted under /api/me/notifications
// after requireAuth, so signed-out callers get 401. Every answer is scoped to
// req.user in the query itself: there is no user id in the address to change.
export function inboxRouter({ pool }) {
  const router = Router();

  router.get('/', async (req, res) => {
    res.json(await listAlerts(pool, req.user, { limit: parseLimit(req.query.limit) }));
  });

  router.post('/read-all', async (req, res) => {
    res.json(await markAllRead(pool, req.user));
  });

  router.post('/:id/read', async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
      return res.status(404).json({ error: 'not_found', message: 'Notification not found.' });
    }
    const result = await markRead(pool, req.user, id);
    if (!result.ok) {
      return res.status(404).json({ error: 'not_found', message: 'Notification not found.' });
    }
    res.json({ id, read: true });
  });

  return router;
}
