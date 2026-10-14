import { Router } from 'express';
import { requirePermission } from '../../middleware/auth.js';

// Read-only viewer for the audit log. The log is append-only by design:
// there is no update or delete route here and never will be. Payloads are
// safe to show because recordAudit refuses passwords, hashes, tokens,
// secrets and salaries at any depth before a row is ever written.

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ACTION = /^[A-Z][A-Z0-9_]*$/;
const ENTITY = /^[a-z][a-z0-9_]*$/;

const positiveInt = (raw) => {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
};
const isoDate = (raw) => (typeof raw === 'string' && ISO_DATE.test(raw) ? raw : null);

function parseQuery(query) {
  return {
    action: typeof query.action === 'string' && ACTION.test(query.action) ? query.action : null,
    entityType:
      typeof query.entityType === 'string' && ENTITY.test(query.entityType)
        ? query.entityType
        : null,
    actorUserId: positiveInt(query.actorUserId),
    from: isoDate(query.from),
    to: isoDate(query.to),
    page: positiveInt(query.page) ?? 1,
    pageSize: Math.min(positiveInt(query.pageSize) ?? 25, 100),
  };
}

export function auditRouter({ pool }) {
  const router = Router();
  const canView = requirePermission('admin.manage');

  router.get('/', canView, async (req, res) => {
    const filters = parseQuery(req.query);
    const where = [];
    const params = [];
    const add = (value) => {
      params.push(value);
      return `$${params.length}`;
    };

    if (filters.action) where.push(`a.action = ${add(filters.action)}`);
    if (filters.entityType) where.push(`a.entity_type = ${add(filters.entityType)}`);
    if (filters.actorUserId) where.push(`a.actor_user_id = ${add(filters.actorUserId)}`);
    if (filters.from) {
      where.push(`(a.occurred_at AT TIME ZONE 'Asia/Colombo')::date >= ${add(filters.from)}::date`);
    }
    if (filters.to) {
      where.push(`(a.occurred_at AT TIME ZONE 'Asia/Colombo')::date <= ${add(filters.to)}::date`);
    }
    const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

    const total = await pool.query(
      `SELECT count(*)::int AS total FROM audit_log a ${whereSql}`,
      params,
    );

    const limit = add(filters.pageSize);
    const offset = add((filters.page - 1) * filters.pageSize);
    const { rows } = await pool.query(
      `SELECT a.id, a.action, a.entity_type, a.entity_id, a.old_values, a.new_values,
              a.details, a.occurred_at, u.full_name AS actor_name, u.email AS actor_email
         FROM audit_log a
         LEFT JOIN users u ON u.id = a.actor_user_id
        ${whereSql}
        ORDER BY a.id DESC
        LIMIT ${limit} OFFSET ${offset}`,
      params,
    );

    res.json({
      items: rows.map((row) => ({
        id: Number(row.id),
        action: row.action,
        entityType: row.entity_type,
        entityId: row.entity_id ? Number(row.entity_id) : null,
        actor: row.actor_name ? { name: row.actor_name, email: row.actor_email } : null,
        oldValues: row.old_values,
        newValues: row.new_values,
        details: row.details,
        occurredAt: row.occurred_at,
      })),
      total: total.rows[0].total,
      page: filters.page,
      pageSize: filters.pageSize,
    });
  });

  return router;
}
