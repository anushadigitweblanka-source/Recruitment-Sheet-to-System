import { Router } from 'express';
import { requirePermission } from '../../middleware/auth.js';
import { listEmployees } from './employees.repository.js';
import {
  getEmployee,
  recordDecision,
  terminateEmployee,
  updateEmployee,
} from './employees.service.js';
import { parseListQuery } from './employees.validation.js';

function sendResult(res, result) {
  if (result.ok) return res.json(result.data);
  if (result.reason === 'not_found') {
    return res.status(404).json({ error: 'not_found', message: 'Employee not found.' });
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

// Employees are created by the offer module, when the offer is marked
// attended, so there is no route to create one here.
export function employeesRouter({ pool }) {
  const router = Router();
  const canView = requirePermission('candidates.view');
  const canManage = requirePermission('employees.manage');
  const notFound = { ok: false, reason: 'not_found' };

  router.get('/', canView, async (req, res) => {
    const filters = parseListQuery(req.query);
    const { items, total } = await listEmployees(pool, filters);
    res.json({ items, total, page: filters.page, pageSize: filters.pageSize });
  });

  router.get('/:id', canView, async (req, res) => {
    const id = positiveId(req.params.id);
    const data = id ? await getEmployee(pool, id) : null;
    sendResult(res, data ? { ok: true, data } : notFound);
  });

  // Only the track can be changed directly. Everything else follows from the
  // offer and the gate decisions.
  router.patch('/:id', canManage, async (req, res) => {
    const id = positiveId(req.params.id);
    sendResult(res, id ? await updateEmployee(pool, req.user, id, req.body) : notFound);
  });

  // The gate decision on the current phase: pass, extend or discontinue.
  router.post('/:id/decision', canManage, async (req, res) => {
    const id = positiveId(req.params.id);
    sendResult(res, id ? await recordDecision(pool, req.user, id, req.body) : notFound);
  });

  router.post('/:id/termination', canManage, async (req, res) => {
    const id = positiveId(req.params.id);
    sendResult(res, id ? await terminateEmployee(pool, req.user, id, req.body) : notFound);
  });

  return router;
}
