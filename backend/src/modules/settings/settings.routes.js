import { Router } from 'express';
import { requirePermission } from '../../middleware/auth.js';
import { inTransaction } from '../../db/transaction.js';
import { recordAudit } from '../audit/audit.js';

// The application settings: the phase durations from the task guide, stored
// in the settings table that Module 5 reads at every gate decision - so an
// edit here takes effect on the next decision, with no restart.
//
// Only rows that already exist can be changed; no key is ever created or
// deleted through the API, and no new setting is invented here.

// Every current setting is a duration (days or months): a whole number,
// at least 1. The cap only blocks obvious slips like a year typed in days.
const MAX_VALUE = 365;

const toSetting = (row) => ({
  key: row.key,
  value: row.value,
  description: row.description,
  updatedAt: row.updated_at,
});

export function settingsRouter({ pool }) {
  const router = Router();
  const canManage = requirePermission('admin.manage');

  router.get('/', canManage, async (req, res) => {
    const { rows } = await pool.query(
      'SELECT key, value, description, updated_at FROM settings ORDER BY key',
    );
    res.json({ items: rows.map(toSetting) });
  });

  router.patch('/:key', canManage, async (req, res) => {
    const { rows } = await pool.query(
      'SELECT key, value, description, updated_at FROM settings WHERE key = $1',
      [req.params.key],
    );
    if (!rows[0]) {
      return res.status(404).json({ error: 'not_found', message: 'No such setting.' });
    }
    const current = rows[0];

    const raw = req.body?.value;
    const value = typeof raw === 'string' ? raw.trim() : raw;
    const n = Number(value);
    if (!Number.isInteger(n) || n < 1 || n > MAX_VALUE) {
      return res.status(422).json({
        error: 'validation_failed',
        message: 'Some fields need correcting.',
        fields: { value: `The value must be a whole number from 1 to ${MAX_VALUE}.` },
      });
    }

    if (String(n) !== current.value) {
      await inTransaction(pool, async (db) => {
        await db.query(
          'UPDATE settings SET value = $1, updated_at = now(), updated_by = $2 WHERE key = $3',
          [String(n), req.user.id, current.key],
        );
        await recordAudit(db, {
          actorUserId: req.user.id,
          action: 'SETTING_UPDATE',
          entityType: 'settings',
          details: { key: current.key },
          oldValues: { value: current.value },
          newValues: { value: String(n) },
        });
      });
    }

    const after = await pool.query(
      'SELECT key, value, description, updated_at FROM settings WHERE key = $1',
      [current.key],
    );
    res.json({ setting: toSetting(after.rows[0]) });
  });

  return router;
}
