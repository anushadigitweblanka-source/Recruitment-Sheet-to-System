import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import express from 'express';
import { apiRouter } from './routes/index.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';

const FRONTEND_DIST = fileURLToPath(new URL('../../frontend/dist', import.meta.url));

// `fetchDocument` and `renderPage` can be replaced in tests so no real network or
// browser is used.
export function createApp({ config, pool, fetchDocument, renderPage }) {
  const app = express();

  app.disable('x-powered-by');
  app.use(express.json());

  app.use('/api', apiRouter({ config, pool, fetchDocument, renderPage }));
  app.use('/api', notFoundHandler);

  // In production the backend also serves the built frontend, so the whole
  // application runs as one process. In development Vite serves the frontend.
  if (config.environment === 'production' && existsSync(FRONTEND_DIST)) {
    app.use(express.static(FRONTEND_DIST));
    app.use((req, res, next) => {
      if (req.method !== 'GET') return next();
      res.sendFile(path.join(FRONTEND_DIST, 'index.html'));
    });
  }

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
