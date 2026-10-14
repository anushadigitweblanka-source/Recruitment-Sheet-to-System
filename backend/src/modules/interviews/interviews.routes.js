import { Router } from 'express';
import { requirePermission } from '../../middleware/auth.js';
import { findInterview, listInterviews } from './interviews.repository.js';
import { createInterview, editInterview } from './interviews.service.js';
import { parseListQuery } from './interviews.validation.js';

function sendResult(res, result, successStatus = 200) {
  if (result.ok) return res.status(successStatus).json(result.data);

  if (result.reason === 'not_found') {
    return res.status(404).json({ error: 'not_found', message: 'Interview not found.' });
  }
  if (result.reason === 'already_exists') {
    return res.status(409).json({
      error: 'already_exists',
      message: 'This candidate already has a direct interview. Edit that one instead.',
      interviewId: result.interviewId,
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

export function interviewsRouter({ pool }) {
  const router = Router();
  const canView = requirePermission('candidates.view');
  const canRecord = requirePermission('interviews.manage');

  // Candidates who have a direct interview, or are waiting for one.
  router.get('/', canView, async (req, res) => {
    const filters = parseListQuery(req.query);
    const { items, total } = await listInterviews(pool, filters);
    res.json({ items, total, page: filters.page, pageSize: filters.pageSize });
  });

  router.post('/', canRecord, async (req, res) => {
    sendResult(res, await createInterview(pool, req.user, req.body), 201);
  });

  router.get('/:id', canView, async (req, res) => {
    const id = positiveId(req.params.id);
    const data = id ? await findInterview(pool, id) : null;
    sendResult(res, data ? { ok: true, data } : { ok: false, reason: 'not_found' });
  });

  router.patch('/:id', canRecord, async (req, res) => {
    const id = positiveId(req.params.id);
    if (!id) return sendResult(res, { ok: false, reason: 'not_found' });
    sendResult(res, await editInterview(pool, req.user, id, req.body));
  });

  return router;
}
