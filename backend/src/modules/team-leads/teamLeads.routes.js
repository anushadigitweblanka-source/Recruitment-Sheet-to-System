import { Router } from 'express';
import { requirePermission } from '../../middleware/auth.js';
import { inTransaction } from '../../db/transaction.js';
import { recordAudit } from '../audit/audit.js';

// The team_leads mapping from the task guide: a position (or team), the Team
// Lead's name and email. The system picks the Team Lead from the candidate's
// applied position. Managed by the Main User (admin.manage); no team lead is
// seeded, so only the details someone enters exist.
//
// user_id optionally links the Team Lead to a login. That link is what limits
// a signed-in Team Lead to their own team's candidates and scores.

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UNIQUE_VIOLATION = '23505';

const positiveId = (raw) => {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
};

const toTeamLead = (row) => ({
  id: Number(row.id),
  position: { id: Number(row.position_id), name: row.position_name },
  teamName: row.team_name,
  name: row.name,
  email: row.email,
  userId: row.user_id ? Number(row.user_id) : null,
  isActive: row.is_active,
  updatedAt: row.updated_at,
});

const SELECT = `
  SELECT t.id, t.position_id, p.name AS position_name, t.team_name, t.name, t.email,
         t.user_id, t.is_active, t.updated_at
    FROM team_leads t JOIN positions p ON p.id = t.position_id`;

// Checks the fields sent. `partial` (a PATCH) checks only what was sent.
async function validate(db, input, { partial }) {
  const source = input && typeof input === 'object' ? input : {};
  const errors = {};
  const values = {};
  const wants = (name) => !partial || source[name] !== undefined;

  if (wants('positionId')) {
    const id = positiveId(source.positionId);
    if (!id) errors.positionId = 'A position must be chosen.';
    else {
      const found = await db.query('SELECT 1 FROM positions WHERE id = $1', [id]);
      if (found.rows.length === 0) errors.positionId = 'This position does not exist.';
      else values.positionId = id;
    }
  }
  if (wants('name')) {
    const name = typeof source.name === 'string' ? source.name.trim() : '';
    if (!name) errors.name = 'Team Lead Name is required.';
    else if (name.length > 150) errors.name = 'Team Lead Name must be at most 150 characters.';
    else values.name = name;
  }
  if (wants('email')) {
    const email = typeof source.email === 'string' ? source.email.trim().toLowerCase() : '';
    if (!email) errors.email = 'Team Lead Email is required.';
    else if (!EMAIL_SHAPE.test(email)) errors.email = 'Team Lead Email is not a valid address.';
    else values.email = email;
  }
  if (wants('teamName')) {
    const raw = source.teamName;
    if (raw === undefined || raw === null || raw === '') values.teamName = null;
    else if (typeof raw !== 'string' || raw.trim().length > 100) {
      errors.teamName = 'Team Name must be at most 100 characters.';
    } else values.teamName = raw.trim();
  }
  if (wants('userId')) {
    const raw = source.userId;
    if (raw === undefined || raw === null || raw === '') values.userId = null;
    else {
      const id = positiveId(raw);
      const found = id
        ? await db.query('SELECT 1 FROM users WHERE id = $1 AND is_active', [id])
        : { rows: [] };
      if (found.rows.length === 0) errors.userId = 'This user does not exist or is not active.';
      else values.userId = id;
    }
  }
  if (wants('isActive')) {
    if (source.isActive === undefined || source.isActive === null) {
      if (!partial) values.isActive = true;
    } else if (typeof source.isActive === 'boolean') values.isActive = source.isActive;
    else errors.isActive = 'Active must be true or false.';
  }
  return { values, errors };
}

export function teamLeadsRouter({ pool }) {
  const router = Router();
  const canManage = requirePermission('admin.manage');

  router.get('/', canManage, async (req, res) => {
    const { rows } = await pool.query(`${SELECT} ORDER BY p.name`);
    res.json({ items: rows.map(toTeamLead) });
  });

  router.post('/', canManage, async (req, res) => {
    const { values, errors } = await validate(pool, req.body, { partial: false });
    if (Object.keys(errors).length > 0) {
      return res.status(422).json({
        error: 'validation_failed',
        message: 'Some fields need correcting.',
        fields: errors,
      });
    }
    try {
      const id = await inTransaction(pool, async (db) => {
        const { rows } = await db.query(
          `INSERT INTO team_leads (position_id, team_name, name, email, user_id, is_active, created_by, updated_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $7) RETURNING id`,
          [
            values.positionId,
            values.teamName ?? null,
            values.name,
            values.email,
            values.userId ?? null,
            values.isActive,
            req.user.id,
          ],
        );
        await recordAudit(db, {
          actorUserId: req.user.id,
          action: 'TEAM_LEAD_CREATE',
          entityType: 'team_leads',
          entityId: Number(rows[0].id),
          newValues: { positionId: values.positionId, isActive: values.isActive },
        });
        return Number(rows[0].id);
      });
      const { rows } = await pool.query(`${SELECT} WHERE t.id = $1`, [id]);
      res.status(201).json({ teamLead: toTeamLead(rows[0]) });
    } catch (err) {
      if (err.code === UNIQUE_VIOLATION) {
        return res.status(422).json({
          error: 'validation_failed',
          message: 'Some fields need correcting.',
          fields: { positionId: 'This position already has a Team Lead. Edit that one instead.' },
        });
      }
      throw err;
    }
  });

  router.patch('/:id', canManage, async (req, res) => {
    const id = positiveId(req.params.id);
    const current = id ? await pool.query('SELECT * FROM team_leads WHERE id = $1', [id]) : null;
    if (!current?.rows[0]) {
      return res.status(404).json({ error: 'not_found', message: 'Team Lead not found.' });
    }
    const { values, errors } = await validate(pool, req.body, { partial: true });
    if (Object.keys(errors).length > 0) {
      return res.status(422).json({
        error: 'validation_failed',
        message: 'Some fields need correcting.',
        fields: errors,
      });
    }

    const columns = {
      positionId: 'position_id',
      teamName: 'team_name',
      name: 'name',
      email: 'email',
      userId: 'user_id',
      isActive: 'is_active',
    };
    const names = Object.keys(values);
    if (names.length > 0) {
      try {
        await inTransaction(pool, async (db) => {
          await db.query(
            `UPDATE team_leads
                SET ${names.map((n, i) => `${columns[n]} = $${i + 1}`).join(', ')},
                    updated_at = now(), updated_by = $${names.length + 1}
              WHERE id = $${names.length + 2}`,
            [...names.map((n) => values[n]), req.user.id, id],
          );
          await recordAudit(db, {
            actorUserId: req.user.id,
            action: 'TEAM_LEAD_UPDATE',
            entityType: 'team_leads',
            entityId: id,
            details: { fields: names },
          });
        });
      } catch (err) {
        if (err.code === UNIQUE_VIOLATION) {
          return res.status(422).json({
            error: 'validation_failed',
            message: 'Some fields need correcting.',
            fields: { positionId: 'This position already has a Team Lead.' },
          });
        }
        throw err;
      }
    }
    const { rows } = await pool.query(`${SELECT} WHERE t.id = $1`, [id]);
    res.json({ teamLead: toTeamLead(rows[0]) });
  });

  return router;
}
