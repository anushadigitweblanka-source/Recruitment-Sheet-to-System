import { Router } from 'express';
import { healthRouter } from './health.js';

// Every API route is mounted here, under /api.
// Feature modules (candidates, interviews, ...) will be added as they are built.
export function apiRouter(deps) {
  const router = Router();

  router.use(healthRouter(deps));

  return router;
}
