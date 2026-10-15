import { Router } from 'express';
import { inTransaction } from '../../db/transaction.js';
import { requirePermission } from '../../middleware/auth.js';
import { recordAudit } from '../audit/audit.js';
import { hashPassword, MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from '../auth/passwords.js';

// Users administration. Everything here uses the existing identity schema
// unchanged: users (with is_active), user_credentials (Argon2id only) and the
// seeded roles. Users are never deleted - the audit log references them - so
// leaving is deactivation. No password, hash or session token ever appears in
// an answer, a log line or an audit payload.

const EMAIL_SHAPE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const MAX_NAME = 150;
const MAX_EMAIL = 254;

const invalid = (res, fields) =>
  res.status(422).json({
    error: 'validation_failed',
    message: 'Some fields need correcting.',
    fields,
  });

const toUser = (row) => ({
  id: Number(row.id),
  fullName: row.full_name,
  email: row.email,
  isActive: row.is_active,
  role: { id: Number(row.role_id), code: row.role_code, name: row.role_name },
  lastLoginAt: row.last_login_at,
  createdAt: row.created_at,
});

const USER_SELECT = `
  SELECT u.id, u.full_name, u.email, u.is_active, u.last_login_at, u.created_at,
         u.role_id, r.code AS role_code, r.name AS role_name
    FROM users u
    JOIN roles r ON r.id = u.role_id`;

function parseNewPassword(raw, fields) {
  if (typeof raw !== 'string' || raw.length < MIN_PASSWORD_LENGTH) {
    fields.password = `The password must be at least ${MIN_PASSWORD_LENGTH} characters long.`;
    return null;
  }
  if (raw.length > MAX_PASSWORD_LENGTH) {
    fields.password = `The password must be at most ${MAX_PASSWORD_LENGTH} characters long.`;
    return null;
  }
  return raw;
}

export function usersRouter({ pool }) {
  const router = Router();
  const canManage = requirePermission('admin.manage');

  router.get('/', canManage, async (req, res) => {
    const { rows } = await pool.query(`${USER_SELECT} ORDER BY u.full_name, u.id`);
    res.json({ items: rows.map(toUser) });
  });

  // The roles a new user can be given: exactly the rows that exist. No role
  // is invented or seeded here; with only main_user in the database, that is
  // the whole list.
  router.get('/roles', canManage, async (req, res) => {
    const { rows } = await pool.query('SELECT id, code, name FROM roles ORDER BY name');
    res.json({
      items: rows.map((row) => ({ id: Number(row.id), code: row.code, name: row.name })),
    });
  });

  router.post('/', canManage, async (req, res) => {
    const source = req.body ?? {};
    const fields = {};

    const fullName = typeof source.fullName === 'string' ? source.fullName.trim() : '';
    if (!fullName) fields.fullName = 'Name is required.';
    else if (fullName.length > MAX_NAME)
      fields.fullName = `Name must be at most ${MAX_NAME} characters.`;

    const email = typeof source.email === 'string' ? source.email.trim().toLowerCase() : '';
    if (!email || !EMAIL_SHAPE.test(email) || email.length > MAX_EMAIL) {
      fields.email = 'Email is not a valid address.';
    }

    const roleId = Number(source.roleId);
    let role = null;
    if (!Number.isInteger(roleId) || roleId < 1) {
      fields.roleId = 'Choose a role.';
    } else {
      const found = await pool.query('SELECT id, code FROM roles WHERE id = $1', [roleId]);
      role = found.rows[0] ?? null;
      if (!role) fields.roleId = 'That role does not exist.';
    }

    const password = parseNewPassword(source.password, fields);
    if (Object.keys(fields).length > 0) return invalid(res, fields);

    const passwordHash = await hashPassword(password);
    try {
      const id = await inTransaction(pool, async (db) => {
        const created = await db.query(
          `INSERT INTO users (email, full_name, role_id, created_by, updated_by)
           VALUES ($1, $2, $3, $4, $4) RETURNING id`,
          [email, fullName, roleId, req.user.id],
        );
        const userId = Number(created.rows[0].id);
        await db.query('INSERT INTO user_credentials (user_id, password_hash) VALUES ($1, $2)', [
          userId,
          passwordHash,
        ]);
        await recordAudit(db, {
          actorUserId: req.user.id,
          action: 'USER_CREATE',
          entityType: 'users',
          entityId: userId,
          newValues: { email, fullName, role: role.code },
        });
        return userId;
      });
      const { rows } = await pool.query(`${USER_SELECT} WHERE u.id = $1`, [id]);
      res.status(201).json({ user: toUser(rows[0]) });
    } catch (err) {
      if (err.code === '23505') {
        return invalid(res, { email: 'A user with this email already exists.' });
      }
      throw err;
    }
  });

  router.patch('/:id/status', canManage, async (req, res) => {
    const id = Number(req.params.id);
    const isActive = req.body?.isActive;
    if (!Number.isInteger(id) || id < 1 || typeof isActive !== 'boolean') {
      return invalid(res, { isActive: 'Send isActive as true or false.' });
    }
    if (id === req.user.id && !isActive) {
      return invalid(res, { isActive: 'You cannot deactivate your own account.' });
    }

    const { rows } = await pool.query(`${USER_SELECT} WHERE u.id = $1`, [id]);
    if (!rows[0]) return res.status(404).json({ error: 'not_found', message: 'No such user.' });
    const user = toUser(rows[0]);

    if (user.isActive !== isActive) {
      await inTransaction(pool, async (db) => {
        await db.query(
          'UPDATE users SET is_active = $1, updated_at = now(), updated_by = $2 WHERE id = $3',
          [isActive, req.user.id, id],
        );
        // A deactivated person is signed out everywhere at once.
        if (!isActive) await db.query('DELETE FROM user_sessions WHERE user_id = $1', [id]);
        await recordAudit(db, {
          actorUserId: req.user.id,
          action: isActive ? 'USER_REACTIVATE' : 'USER_DEACTIVATE',
          entityType: 'users',
          entityId: id,
          oldValues: { isActive: user.isActive },
          newValues: { isActive },
        });
      });
    }
    const after = await pool.query(`${USER_SELECT} WHERE u.id = $1`, [id]);
    res.json({ user: toUser(after.rows[0]) });
  });

  router.post('/:id/reset-password', canManage, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
      return res.status(404).json({ error: 'not_found', message: 'No such user.' });
    }
    const fields = {};
    const password = parseNewPassword(req.body?.password, fields);
    if (!password) return invalid(res, fields);

    const { rows } = await pool.query('SELECT id FROM users WHERE id = $1', [id]);
    if (!rows[0]) return res.status(404).json({ error: 'not_found', message: 'No such user.' });

    const passwordHash = await hashPassword(password);
    await inTransaction(pool, async (db) => {
      await db.query(
        `UPDATE user_credentials
            SET password_hash = $1, password_changed_at = now(),
                failed_login_attempts = 0, locked_until = NULL
          WHERE user_id = $2`,
        [passwordHash, id],
      );
      // The old password's sessions end immediately.
      await db.query('DELETE FROM user_sessions WHERE user_id = $1', [id]);
      await recordAudit(db, {
        actorUserId: req.user.id,
        action: 'USER_PASSWORD_RESET',
        entityType: 'users',
        entityId: id,
      });
    });
    res.json({ reset: true });
  });

  return router;
}
