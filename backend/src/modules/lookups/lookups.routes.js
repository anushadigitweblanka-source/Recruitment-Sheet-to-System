import { Router } from 'express';
import { requirePermission } from '../../middleware/auth.js';
import { recordAudit } from '../audit/audit.js';

// The closed lists used by dropdowns: positions, sources and pipeline stages.
// The table name always comes from this fixed map, never from the request.
const EDITABLE_LISTS = {
  positions: { table: 'positions', label: 'Position' },
  sources: { table: 'sources', label: 'Source' },
};

const UNIQUE_VIOLATION = '23505';
const MAX_NAME_LENGTH = 100;

const toItem = (row) => ({ id: Number(row.id), name: row.name, isActive: row.is_active });

export function lookupsRouter({ pool }) {
  const router = Router();
  const canView = requirePermission('candidates.view');
  const canManage = requirePermission('admin.manage');

  router.get('/stages', canView, async (req, res) => {
    const { rows } = await pool.query('SELECT code, name FROM pipeline_stages ORDER BY sort_order');
    res.json({ items: rows });
  });

  router.get('/:list', canView, async (req, res) => {
    const list = EDITABLE_LISTS[req.params.list];
    if (!list) return res.status(404).json({ error: 'not_found', message: 'No such list.' });

    const { rows } = await pool.query(
      `SELECT id, name, is_active FROM ${list.table} ORDER BY lower(name)`,
    );
    res.json({ items: rows.map(toItem) });
  });

  router.post('/:list', canManage, async (req, res) => {
    const list = EDITABLE_LISTS[req.params.list];
    if (!list) return res.status(404).json({ error: 'not_found', message: 'No such list.' });

    const raw = req.body?.name;
    const name = typeof raw === 'string' ? raw.trim().replace(/\s+/g, ' ') : '';
    const invalid = (message) =>
      res.status(422).json({ error: 'validation_failed', message, fields: { name: message } });

    if (!name) return invalid(`${list.label} name is required.`);
    if (name.length > MAX_NAME_LENGTH) {
      return invalid(`${list.label} name must be at most ${MAX_NAME_LENGTH} characters.`);
    }

    try {
      const { rows } = await pool.query(
        `INSERT INTO ${list.table} (name, created_by, updated_by) VALUES ($1, $2, $2)
         RETURNING id, name, is_active`,
        [name, req.user.id],
      );
      await recordAudit(pool, {
        actorUserId: req.user.id,
        action: 'LOOKUP_CREATE',
        entityType: list.table,
        entityId: Number(rows[0].id),
        newValues: { name },
      });
      res.status(201).json({ item: toItem(rows[0]) });
    } catch (err) {
      if (err.code === UNIQUE_VIOLATION)
        return invalid(`This ${list.label.toLowerCase()} already exists.`);
      throw err;
    }
  });

  return router;
}
