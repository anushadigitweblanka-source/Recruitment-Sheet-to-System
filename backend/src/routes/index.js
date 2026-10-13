import { Router } from 'express';
import { attachUser, requireAuth } from '../middleware/auth.js';
import { authRouter } from '../modules/auth/auth.routes.js';
import { candidatesRouter } from '../modules/candidates/candidates.routes.js';
import { lookupsRouter } from '../modules/lookups/lookups.routes.js';
import { phoneScreensRouter } from '../modules/phone-screens/phoneScreens.routes.js';
import { healthRouter } from './health.js';

// Every API route is mounted here, under /api.
export function apiRouter(deps) {
  const router = Router();

  // API answers are never stored by the browser, so nothing can be read back
  // from its cache after signing out.
  router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  // Open to everyone: the health check and signing in.
  router.use(healthRouter(deps));
  router.use(attachUser(deps));
  router.use('/auth', authRouter(deps));

  // Everything below this line requires a signed-in user. Feature modules are
  // mounted here, so a new route is protected unless it is deliberately opened.
  router.use(requireAuth);

  // Each of these also checks a specific permission on every route.
  router.use('/candidates', candidatesRouter(deps));
  router.use('/lookups', lookupsRouter(deps));
  router.use(phoneScreensRouter(deps));

  return router;
}
