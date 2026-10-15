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
//
// Most settings are durations (whole numbers). A few settings hold text the
// mail automation reads - recipient addresses, the venue, the Company CV
// template link. Each of those has its own check below.

// Every current setting is a duration (days or months): a whole number,
// at least 1. The cap only blocks obvious slips like a year typed in days.
const MAX_VALUE = 365;

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Text settings and how each is checked. An empty value is allowed: it means
// "not set yet".
const TEXT_SETTINGS = {
  reminder_hr_emails: 'emails',
  reminder_manager_emails: 'emails',
  weekly_report_recipients: 'emails',
  evaluation_reminder_include_candidate: 'boolean',
  interview_venue: 'text',
  company_cv_template_url: 'url',
};

// Returns { value } or { error }.
function checkTextSetting(kind, raw) {
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (typeof raw !== 'string') return { error: 'The value must be text.' };
  if (kind === 'boolean') {
    return text === 'true' || text === 'false'
      ? { value: text }
      : { error: 'The value must be true or false.' };
  }
  if (kind === 'emails') {
    const parts = text
      .split(/[,;\s]+/)
      .map((part) => part.toLowerCase())
      .filter(Boolean);
    const bad = parts.filter((part) => !EMAIL_SHAPE.test(part));
    if (bad.length > 0) return { error: 'Every address must be a valid email address.' };
    if (parts.length > 20) return { error: 'At most 20 addresses.' };
    return { value: parts.join(', ') };
  }
  if (kind === 'url') {
    if (text && !/^https?:\/\/[^\s]+$/.test(text)) {
      return { error: 'The value must be an http or https link.' };
    }
    if (text.length > 500) return { error: 'The link must be at most 500 characters.' };
    return { value: text };
  }
  if (text.length > 300) return { error: 'The value must be at most 300 characters.' };
  return { value: text };
}

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
    let next;
    const textKind = TEXT_SETTINGS[current.key];
    if (textKind) {
      const checked = checkTextSetting(textKind, raw);
      if (checked.error) {
        return res.status(422).json({
          error: 'validation_failed',
          message: 'Some fields need correcting.',
          fields: { value: checked.error },
        });
      }
      next = checked.value;
    } else {
      const value = typeof raw === 'string' ? raw.trim() : raw;
      const n = Number(value);
      if (!Number.isInteger(n) || n < 1 || n > MAX_VALUE) {
        return res.status(422).json({
          error: 'validation_failed',
          message: 'Some fields need correcting.',
          fields: { value: `The value must be a whole number from 1 to ${MAX_VALUE}.` },
        });
      }
      next = String(n);
    }

    if (next !== current.value) {
      await inTransaction(pool, async (db) => {
        await db.query(
          'UPDATE settings SET value = $1, updated_at = now(), updated_by = $2 WHERE key = $3',
          [next, req.user.id, current.key],
        );
        await recordAudit(db, {
          actorUserId: req.user.id,
          action: 'SETTING_UPDATE',
          entityType: 'settings',
          details: { key: current.key },
          oldValues: { value: current.value },
          newValues: { value: next },
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
