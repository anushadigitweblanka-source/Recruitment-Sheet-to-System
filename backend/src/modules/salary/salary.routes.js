import { Router } from 'express';
import { requirePermission } from '../../middleware/auth.js';
import { inTransaction } from '../../db/transaction.js';
import { recordAudit } from '../audit/audit.js';

// Salary, from the task guide: stored only in offer_salary, linked to the
// candidate, readable and editable only by the Main User (salary.view and
// salary.edit are granted to no other role).
//
// Every VIEW and every CHANGE is written to the audit log - the fact, the
// person and the candidate, never the amount. Salary appears in no other
// route, report, export, mail, notification or log.

const MAX_SALARY = 9_999_999_999.99;

const positiveId = (raw) => {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
};

const toSalary = (row) => ({
  candidateId: Number(row.candidate_id),
  salaryLkr: Number(row.salary_lkr),
  updatedAt: row.updated_at,
});

export function salaryRouter({ pool }) {
  const router = Router();
  const canView = requirePermission('salary.view');
  const canEdit = requirePermission('salary.edit');

  router.get('/:candidateId', canView, async (req, res) => {
    const candidateId = positiveId(req.params.candidateId);
    if (!candidateId) {
      return res.status(404).json({ error: 'not_found', message: 'Candidate not found.' });
    }
    const exists = await pool.query('SELECT 1 FROM candidates WHERE id = $1', [candidateId]);
    if (exists.rows.length === 0) {
      return res.status(404).json({ error: 'not_found', message: 'Candidate not found.' });
    }

    const { rows } = await pool.query(
      'SELECT candidate_id, salary_lkr, updated_at FROM offer_salary WHERE candidate_id = $1',
      [candidateId],
    );
    // The view is logged whether or not a salary exists yet.
    await recordAudit(pool, {
      actorUserId: req.user.id,
      action: 'SALARY_VIEW',
      entityType: 'offer_salary',
      entityId: candidateId,
      details: { found: rows.length > 0 },
    });
    res.json({ salary: rows[0] ? toSalary(rows[0]) : null });
  });

  router.put('/:candidateId', canEdit, async (req, res) => {
    const candidateId = positiveId(req.params.candidateId);
    const exists = candidateId
      ? await pool.query('SELECT 1 FROM candidates WHERE id = $1', [candidateId])
      : { rows: [] };
    if (exists.rows.length === 0) {
      return res.status(404).json({ error: 'not_found', message: 'Candidate not found.' });
    }

    const raw = req.body?.salaryLkr;
    const amount = typeof raw === 'string' ? Number(raw.trim()) : raw;
    if (
      typeof amount !== 'number' ||
      !Number.isFinite(amount) ||
      amount < 0 ||
      amount > MAX_SALARY ||
      Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-6 // at most 2 decimals
    ) {
      return res.status(422).json({
        error: 'validation_failed',
        message: 'Some fields need correcting.',
        fields: { salaryLkr: 'Salary must be a number from 0, with at most 2 decimals.' },
      });
    }

    const result = await inTransaction(pool, async (db) => {
      const before = await db.query('SELECT 1 FROM offer_salary WHERE candidate_id = $1', [
        candidateId,
      ]);
      const { rows } = await db.query(
        `INSERT INTO offer_salary (candidate_id, salary_lkr, created_by, updated_by)
         VALUES ($1, $2, $3, $3)
         ON CONFLICT (candidate_id) DO UPDATE
            SET salary_lkr = EXCLUDED.salary_lkr, updated_at = now(), updated_by = EXCLUDED.updated_by
         RETURNING candidate_id, salary_lkr, updated_at`,
        [candidateId, amount, req.user.id],
      );
      await recordAudit(db, {
        actorUserId: req.user.id,
        action: 'SALARY_CHANGE',
        entityType: 'offer_salary',
        entityId: candidateId,
        details: { created: before.rows.length === 0 },
      });
      return toSalary(rows[0]);
    });
    res.json({ salary: result });
  });

  return router;
}
