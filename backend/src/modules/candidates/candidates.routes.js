import { Router } from 'express';
import { requireAnyPermission, requirePermission, teamScopeFor } from '../../middleware/auth.js';
import { peekNextCandidateId } from './candidateId.js';
import { findCandidate, listCandidates } from './candidates.repository.js';
import { createCandidate, editCandidate } from './candidates.service.js';
import { parseListQuery } from './candidates.validation.js';

// Turns a service result into an HTTP answer.
function sendResult(res, result, successStatus = 200) {
  if (result.ok) {
    return res.status(successStatus).json({ candidate: result.candidate });
  }
  if (result.reason === 'not_found') {
    return res.status(404).json({ error: 'not_found', message: 'Candidate not found.' });
  }
  if (result.reason === 'duplicate') {
    return res.status(409).json({
      error: 'possible_duplicate',
      message:
        'This looks like a candidate who already exists. Check the matches, then save again to confirm.',
      duplicates: result.duplicates,
    });
  }
  return res.status(422).json({
    error: 'validation_failed',
    message: 'Some fields need correcting.',
    fields: result.fields,
  });
}

// An id in the address must be a positive whole number; anything else is not found.
function candidateId(req) {
  const id = Number(req.params.id);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export function candidatesRouter({ pool }) {
  const router = Router();
  // HR sees every candidate; a Team Lead (candidates.view_team) only their team's.
  const canView = requireAnyPermission('candidates.view', 'candidates.view_team');
  const canEdit = requirePermission('candidates.edit');

  router.get('/', canView, async (req, res) => {
    const filters = parseListQuery(req.query);
    const { items, total } = await listCandidates(pool, filters, teamScopeFor(req.user));
    res.json({ items, total, page: filters.page, pageSize: filters.pageSize });
  });

  // A preview of the Candidate ID the next saved candidate would get. It reserves
  // nothing; the real ID is assigned when the candidate is saved. This must come
  // before the '/:id' route so "next-id" is not read as a candidate number.
  router.get('/next-id', canEdit, async (req, res) => {
    res.json({ candidateCode: await peekNextCandidateId(pool), preview: true });
  });

  router.post('/', canEdit, async (req, res) => {
    const { confirmDuplicate, ...input } = req.body ?? {};
    const result = await createCandidate(pool, req.user, input, {
      confirmDuplicate: confirmDuplicate === true,
    });
    sendResult(res, result, 201);
  });

  router.get('/:id', canView, async (req, res) => {
    const id = candidateId(req);
    const candidate = id ? await findCandidate(pool, id, teamScopeFor(req.user)) : null;
    sendResult(res, candidate ? { ok: true, candidate } : { ok: false, reason: 'not_found' });
  });

  router.put('/:id', canEdit, async (req, res) => {
    const id = candidateId(req);
    if (!id) return sendResult(res, { ok: false, reason: 'not_found' });

    const { confirmDuplicate, ...input } = req.body ?? {};
    const result = await editCandidate(pool, req.user, id, input, {
      confirmDuplicate: confirmDuplicate === true,
    });
    sendResult(res, result);
  });

  return router;
}
