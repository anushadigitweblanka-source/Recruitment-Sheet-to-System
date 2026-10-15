import express, { Router } from 'express';
import { requireAnyPermission } from '../../middleware/auth.js';
import { ALLOWED_TYPES, createDevStorage } from '../../storage/devStorage.js';
import { COMPANY_CV_MAX_BYTES, checkUploadLink, receiveUpload } from './companyCv.service.js';

const REASONS = {
  invalid_link: [404, 'This upload link is not valid.'],
  already_used: [410, 'This upload link has already been used.'],
  expired: [410, 'This upload link has expired. Ask HR for a new one.'],
  no_file: [422, 'No file was received.'],
  too_large: [413, 'The file is too large (5 MB at most).'],
  not_a_pdf: [422, 'The file is not a valid PDF.'],
};

const failure = (res, reason) => {
  const [status, message] = REASONS[reason] ?? [400, 'The upload could not be completed.'];
  return res.status(status).json({ error: reason, message });
};

// The candidate's own upload page talks to these two routes. They are open
// (a candidate has no login): the unguessable, single-use, expiring link is
// the only credential, and it can do nothing except attach one CV to the
// candidate it was made for.
export function publicCompanyCvRouter({ config, pool }) {
  const router = Router();
  const storage = createDevStorage({ dir: config.devStorageDir });

  router.get('/company-cv/:token', async (req, res) => {
    const result = await checkUploadLink(pool, req.params.token);
    if (!result.ok) return failure(res, result.reason);
    res.json({ ok: true });
  });

  router.put(
    '/company-cv/:token',
    express.raw({ type: Object.keys(ALLOWED_TYPES), limit: COMPANY_CV_MAX_BYTES }),
    async (req, res) => {
      const contentType = (req.headers['content-type'] ?? '').split(';')[0].trim();
      if (!ALLOWED_TYPES[contentType]) {
        return res.status(415).json({
          error: 'unsupported_type',
          message: 'Upload a PDF or Word document.',
        });
      }
      const result = await receiveUpload(pool, {
        storage,
        config,
        token: req.params.token,
        buffer: req.body,
        contentType,
      });
      if (!result.ok) return failure(res, result.reason);
      // Nothing about the candidate is returned to the person holding the link.
      res.status(201).json({ ok: true });
    },
  );

  return router;
}

// Staff read an uploaded CV back. A Team Lead may only open the CV of a
// candidate of their own team.
export function companyCvFilesRouter({ config, pool }) {
  const router = Router();
  const storage = createDevStorage({ dir: config.devStorageDir });
  const canView = requireAnyPermission('candidates.view', 'candidates.view_team');

  router.get('/company-cv-files/:name', canView, async (req, res) => {
    const scoped = !req.user.permissions.includes('candidates.view');
    const owner = await pool.query(
      `SELECT c.id FROM candidates c
        WHERE c.company_cv_url LIKE '%/company-cv-files/' || $1
          AND ($2::boolean = false OR c.position_id IN (
                SELECT position_id FROM team_leads WHERE user_id = $3 AND is_active))`,
      [req.params.name, scoped, req.user.id],
    );
    const buffer = owner.rows[0] ? await storage.read(req.params.name) : null;
    if (!buffer) return res.status(404).json({ error: 'not_found', message: 'File not found.' });

    const extension = req.params.name.split('.').pop();
    const contentType = Object.keys(ALLOWED_TYPES).find(
      (type) => ALLOWED_TYPES[type] === `.${extension}`,
    );
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="company-cv.${extension}"`);
    res.send(buffer);
  });

  return router;
}
