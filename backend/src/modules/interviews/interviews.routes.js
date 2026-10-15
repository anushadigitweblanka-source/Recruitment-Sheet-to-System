import { Router } from 'express';
import { requireAnyPermission, teamScopeFor } from '../../middleware/auth.js';
import { teamScopeClause } from '../team-leads/teamScope.js';
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
  // HR sees every interview; a Team Lead (candidates.view_team) only their
  // team's, and may add comments and scores (interviews.score) for those.
  const canView = requireAnyPermission('candidates.view', 'candidates.view_team');
  const canRecord = requireAnyPermission('interviews.manage', 'interviews.score');

  // A user who holds interviews.score but not interviews.manage is a Team
  // Lead: they may only record for a candidate of their own team.
  const inUsersTeam = async (user, candidateId) => {
    if (user.permissions.includes('interviews.manage')) return true;
    const { rows } = await pool.query(
      `SELECT 1 FROM candidates c WHERE c.id = $1 AND ${teamScopeClause('$2')}`,
      [candidateId, user.id],
    );
    return rows.length > 0;
  };
  const outsideTeam = (res) =>
    res.status(403).json({
      error: 'forbidden',
      message: 'This candidate is not in a team you lead.',
    });

  // Candidates who have a direct interview, or are waiting for one.
  router.get('/', canView, async (req, res) => {
    const filters = parseListQuery(req.query);
    const { items, total } = await listInterviews(pool, filters, teamScopeFor(req.user));
    res.json({ items, total, page: filters.page, pageSize: filters.pageSize });
  });

  router.post('/', canRecord, async (req, res) => {
    const candidateId = Number(req.body?.candidateId);
    if (
      Number.isInteger(candidateId) &&
      candidateId > 0 &&
      !(await inUsersTeam(req.user, candidateId))
    ) {
      return outsideTeam(res);
    }
    sendResult(res, await createInterview(pool, req.user, req.body), 201);
  });

  router.get('/:id', canView, async (req, res) => {
    const id = positiveId(req.params.id);
    const data = id ? await findInterview(pool, id, teamScopeFor(req.user)) : null;
    sendResult(res, data ? { ok: true, data } : { ok: false, reason: 'not_found' });
  });

  router.patch('/:id', canRecord, async (req, res) => {
    const id = positiveId(req.params.id);
    if (!id) return sendResult(res, { ok: false, reason: 'not_found' });
    const current = await findInterview(pool, id);
    if (current && !(await inUsersTeam(req.user, current.candidate.id))) return outsideTeam(res);
    sendResult(res, await editInterview(pool, req.user, id, req.body));
  });

  return router;
}
