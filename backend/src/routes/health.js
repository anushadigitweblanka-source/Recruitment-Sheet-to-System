import { Router } from 'express';
import { checkDatabase } from '../db/pool.js';

export function healthRouter({ config, pool }) {
  const router = Router();

  router.get('/health', async (req, res) => {
    const database = await checkDatabase(pool);

    res.status(database.ok ? 200 : 503).json({
      status: database.ok ? 'ok' : 'degraded',
      environment: config.environment,
      database: database.ok
        ? { status: 'connected', latencyMs: database.latencyMs }
        : { status: 'unavailable' },
      timestamp: new Date().toISOString(),
    });
  });

  return router;
}
