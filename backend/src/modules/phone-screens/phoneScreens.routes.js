import { Router } from 'express';
import { requirePermission } from '../../middleware/auth.js';
import { findForCandidate, listPhoneScreens } from './phoneScreens.repository.js';
import { createPhoneScreen, editPhoneScreen } from './phoneScreens.service.js';
import { parseListQuery } from './phoneScreens.validation.js';

function sendResult(res, result, successStatus = 200) {
  if (result.ok) return res.status(successStatus).json(result.data);

  if (result.reason === 'not_found') {
    return res.status(404).json({ error: 'not_found', message: 'Phone interview not found.' });
  }
  if (result.reason === 'already_exists') {
    return res.status(409).json({
      error: 'already_exists',
      message: 'This candidate already has a phone interview. Edit that one instead.',
      candidateId: result.candidateId,
    });
  }
  return res.status(422).json({
    error: 'validation_failed',
    message: 'Some fields need correcting.',
    fields: result.fields,
  });
}

const positiveId = (raw) => {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
};

// Mounted at /api, so the paths below are complete.
export function phoneScreensRouter({ pool }) {
  const router = Router();
  const canView = requirePermission('candidates.view');
  const canRecord = requirePermission('interviews.manage');

  // Every candidate, with their phone interview if one has been recorded.
  router.get('/phone-interviews', canView, async (req, res) => {
    const filters = parseListQuery(req.query);
    const { items, total } = await listPhoneScreens(pool, filters);
    res.json({ items, total, page: filters.page, pageSize: filters.pageSize });
  });

  // One candidate with their phone interview (null if not recorded yet).
  router.get('/candidates/:id/phone-interview', canView, async (req, res) => {
    const id = positiveId(req.params.id);
    const data = id ? await findForCandidate(pool, id) : null;
    if (!data) return res.status(404).json({ error: 'not_found', message: 'Candidate not found.' });
    res.json(data);
  });

  router.post('/phone-interviews', canRecord, async (req, res) => {
    sendResult(res, await createPhoneScreen(pool, req.user, req.body), 201);
  });

  router.patch('/phone-interviews/:id', canRecord, async (req, res) => {
    const id = positiveId(req.params.id);
    if (!id) return sendResult(res, { ok: false, reason: 'not_found' });
    sendResult(res, await editPhoneScreen(pool, req.user, id, req.body));
  });

  return router;
}
