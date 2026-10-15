import { Router } from 'express';
import { requirePermission } from '../../middleware/auth.js';

// Read-only view of roles and permissions on the existing identity schema.
// The final role list (HR, Team Lead, Intern) and the editable permission
// structure are still a mentor decision, so this module deliberately has no
// create, edit, delete or assignment route: it only shows what exists in the
// database today. Nothing here returns credentials, sessions or user rows.

const ROLE_SELECT = `
  SELECT r.id, r.code, r.name, r.description,
         count(DISTINCT u.id)::int AS user_count,
         array_remove(array_agg(DISTINCT p.code), NULL) AS permission_codes
    FROM roles r
    LEFT JOIN users u ON u.role_id = r.id
    LEFT JOIN role_permissions rp ON rp.role_id = r.id
    LEFT JOIN permissions p ON p.id = rp.permission_id
   GROUP BY r.id`;

const toRole = (row) => ({
  id: Number(row.id),
  code: row.code,
  name: row.name,
  description: row.description,
  userCount: row.user_count,
  permissions: [...row.permission_codes].sort(),
});

export function rolesRouter({ pool }) {
  const router = Router();
  const canView = requirePermission('admin.manage');

  // The list plus the full permission catalogue, so the page can draw the
  // permission matrix without a second request.
  router.get('/', canView, async (req, res) => {
    const roles = await pool.query(`${ROLE_SELECT} ORDER BY r.name, r.id`);
    const permissions = await pool.query(
      'SELECT id, code, description FROM permissions ORDER BY code',
    );
    res.json({
      items: roles.rows.map(toRole),
      permissions: permissions.rows.map((row) => ({
        id: Number(row.id),
        code: row.code,
        description: row.description,
      })),
    });
  });

  router.get('/:id', canView, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
      return res.status(404).json({ error: 'not_found', message: 'No such role.' });
    }
    const { rows } = await pool.query(`${ROLE_SELECT} HAVING r.id = $1`, [id]);
    if (!rows[0]) return res.status(404).json({ error: 'not_found', message: 'No such role.' });
    res.json({ role: toRole(rows[0]) });
  });

  return router;
}
