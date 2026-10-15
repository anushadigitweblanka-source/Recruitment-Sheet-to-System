import { createHash, randomBytes } from 'node:crypto';
import { inTransaction } from '../../db/transaction.js';
import { recordAudit } from '../audit/audit.js';

// The Company CV flow from the task guide:
//
//   1. The interview invitation carries the Company CV template (a link kept
//      in Settings) and an upload link unique to the candidate.
//   2. The candidate uploads the filled CV through that link; the result is
//      stored in candidates.company_cv_url and the status becomes Received.
//   3. If it has not arrived 24 hours before the interview the candidate is
//      reminded (see notifications/scheduling.js) and the candidate shows as
//      CV pending to HR and the Team Lead.
//
// CV Status values: not_sent, sent, received, overdue.

const LINK_LIFETIME_DAYS = 14;
export const COMPANY_CV_MAX_BYTES = 5 * 1024 * 1024;

const hashToken = (token) => createHash('sha256').update(token).digest('hex');

// A new upload link for this candidate. Only the hash of the token is stored;
// the returned address is the only place the token ever appears.
export async function createUploadLink(db, { candidateId, userId = null, baseUrl }) {
  const token = randomBytes(24).toString('base64url');
  await db.query(
    `INSERT INTO company_cv_links (candidate_id, token_hash, expires_at, created_by)
     VALUES ($1, $2, now() + make_interval(days => $3), $4)`,
    [candidateId, hashToken(token), LINK_LIFETIME_DAYS, userId],
  );
  return `${baseUrl}/company-cv/upload/${token}`;
}

// What a candidate's upload page may know: only that the link works.
export async function checkUploadLink(pool, token) {
  const { rows } = await pool.query(
    `SELECT used_at, expires_at > now() AS live FROM company_cv_links WHERE token_hash = $1`,
    [hashToken(token)],
  );
  const row = rows[0];
  if (!row) return { ok: false, reason: 'invalid_link' };
  if (row.used_at) return { ok: false, reason: 'already_used' };
  if (!row.live) return { ok: false, reason: 'expired' };
  return { ok: true };
}

// The candidate uploads the filled CV. Everything is saved together or not at
// all, and a link works once.
export async function receiveUpload(pool, { storage, config, token, buffer, contentType }) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) return { ok: false, reason: 'no_file' };
  if (buffer.length > COMPANY_CV_MAX_BYTES) return { ok: false, reason: 'too_large' };
  if (contentType === 'application/pdf' && buffer.subarray(0, 4).toString() !== '%PDF') {
    return { ok: false, reason: 'not_a_pdf' };
  }

  return inTransaction(pool, async (db) => {
    const { rows } = await db.query(
      `SELECT id, candidate_id, used_at, expires_at > now() AS live
         FROM company_cv_links WHERE token_hash = $1 FOR UPDATE`,
      [hashToken(token)],
    );
    const link = rows[0];
    if (!link) return { ok: false, reason: 'invalid_link' };
    if (link.used_at) return { ok: false, reason: 'already_used' };
    if (!link.live) return { ok: false, reason: 'expired' };

    const { name } = await storage.save({ buffer, contentType });
    const url = `${config.publicBaseUrl}/api/company-cv-files/${name}`;
    const candidateId = Number(link.candidate_id);

    await db.query(
      `UPDATE candidates SET company_cv_url = $2, company_cv_status = 'received', updated_at = now()
        WHERE id = $1`,
      [candidateId, url],
    );
    await db.query('UPDATE company_cv_links SET used_at = now() WHERE id = $1', [link.id]);
    // The CV has arrived, so a reminder still waiting is no longer needed.
    await db.query(
      `UPDATE notifications SET status = 'cancelled'
        WHERE candidate_id = $1 AND type = 'cv_pending' AND status IN ('pending', 'failed')
          AND sent_at IS NULL`,
      [candidateId],
    );
    await recordAudit(db, {
      action: 'COMPANY_CV_RECEIVED',
      entityType: 'candidates',
      entityId: candidateId,
      details: { via: 'upload_link' },
    });
    return { ok: true, candidateId };
  });
}

// Marks the invitation as sent, unless the CV is already in.
export async function markCompanyCvSent(db, candidateId) {
  await db.query(
    `UPDATE candidates SET company_cv_status = 'sent', updated_at = now()
      WHERE id = $1 AND company_cv_status = 'not_sent'`,
    [candidateId],
  );
}

// The 24-hour reminder found no CV: the status becomes Overdue.
export async function markCompanyCvOverdue(db, candidateId) {
  await db.query(
    `UPDATE candidates SET company_cv_status = 'overdue', updated_at = now()
      WHERE id = $1 AND company_cv_status IN ('not_sent', 'sent')`,
    [candidateId],
  );
}
