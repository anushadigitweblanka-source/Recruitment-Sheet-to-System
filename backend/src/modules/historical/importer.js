// The historical interview log importer: dry run, guarded import and rollback.
//
// What it will never do:
//   - write to any recruitment table. It writes only historical_import_batches
//     and historical_interview_records, which reference nothing else;
//   - call a service, the scheduler or the mail code, so a historical record
//     cannot create a reminder, an email, an offer, an employee or a stage
//     change;
//   - run without the file fingerprint being confirmed, a recent backup file
//     being named, and a development database.
//
// The tables come from migration 015. In a database without them, every
// database function here refuses with "not available" and nothing can be
// written.

import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { basename } from 'node:path';
import { inTransaction } from '../../db/transaction.js';
import { readCsvSheet } from '../../import/csv.js';
import { recordAudit } from '../audit/audit.js';
import { buildRecords, summarize } from './review.js';

// Everything the live recruitment flow owns. An import must leave every count
// exactly as it found it.
export const GUARDED_TABLES = [
  'candidates',
  'pipeline_status',
  'stage_history',
  'phone_screens',
  'interviews',
  'offers',
  'employees',
  'phase_history',
  'notifications',
  'email_log',
];

const CHUNK = 100;

export class HistoricalError extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.code = code;
    Object.assign(this, extra);
  }
}

export async function tablesAvailable(db) {
  const { rows } = await db.query(
    `SELECT to_regclass('historical_import_batches') IS NOT NULL
        AND to_regclass('historical_interview_records') IS NOT NULL AS ok`,
  );
  return rows[0].ok === true;
}

export async function tableCounts(db) {
  const counts = {};
  for (const table of GUARDED_TABLES) {
    const { rows } = await db.query(`SELECT count(*)::int AS n FROM ${table}`);
    counts[table] = rows[0].n;
  }
  return counts;
}

function assertSameCounts(before, after) {
  const changed = GUARDED_TABLES.filter((table) => before[table] !== after[table]);
  if (changed.length > 0) {
    throw new HistoricalError(
      'side_effect',
      `Refused: the import changed ${changed.join(', ')}. Nothing was saved.`,
    );
  }
}

// Reads and checks the file. Returns counts only through summarize(); the
// records themselves are returned for the import and never printed.
export async function readHistoricalFile(path) {
  const bytes = readFileSync(path);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const sheet = await readCsvSheet(path);
  const records = buildRecords(sheet);
  return {
    fileName: basename(path),
    sha256,
    encoding: sheet.meta.encoding,
    records,
    summary: summarize(records),
  };
}

// A dry run: no database access at all.
export async function dryRun(path) {
  const file = await readHistoricalFile(path);
  return {
    fileName: file.fileName,
    fingerprint: file.sha256.slice(0, 16),
    encoding: file.encoding,
    ...file.summary,
  };
}

// The backup the import insists on: an existing, non-empty file written
// recently. It cannot prove the backup restores; it proves one was taken.
export function verifyBackup(path, { now = Date.now(), maxAgeHours = 24 } = {}) {
  let stat;
  try {
    stat = statSync(path);
  } catch {
    throw new HistoricalError('no_backup', 'The backup file does not exist.');
  }
  if (!stat.isFile() || stat.size === 0) {
    throw new HistoricalError('no_backup', 'The backup file is empty.');
  }
  if (now - stat.mtimeMs > maxAgeHours * 3600 * 1000) {
    throw new HistoricalError('stale_backup', `The backup is older than ${maxAgeHours} hours.`);
  }
  return { sizeBytes: stat.size, modifiedAt: new Date(stat.mtimeMs) };
}

const textOrNull = (v) => (v === null || v === undefined ? null : String(v));

export async function executeImport(pool, path, { confirmSha, userId = null } = {}) {
  if (!(await tablesAvailable(pool))) {
    throw new HistoricalError(
      'not_available',
      'The historical interview tables do not exist in this database yet.',
    );
  }
  const file = await readHistoricalFile(path);
  const confirm = String(confirmSha ?? '').toLowerCase();
  if (confirm.length < 16 || !file.sha256.startsWith(confirm)) {
    throw new HistoricalError(
      'fingerprint_mismatch',
      'The file fingerprint does not match the one confirmed. Nothing was written.',
    );
  }

  return inTransaction(pool, async (db) => {
    const live = await db.query(
      `SELECT id FROM historical_import_batches
        WHERE file_sha256 = $1 AND status <> 'rolled_back'`,
      [file.sha256],
    );
    if (live.rows.length > 0) {
      throw new HistoricalError(
        'already_imported',
        'This file has already been imported. Roll that batch back first to load it again.',
        { batchId: Number(live.rows[0].id) },
      );
    }

    const before = await tableCounts(db);
    const batch = await db.query(
      `INSERT INTO historical_import_batches
         (file_name, file_sha256, encoding, record_count, imported_by)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [file.fileName, file.sha256, file.encoding, file.records.length, userId],
    );
    const batchId = Number(batch.rows[0].id);

    for (let i = 0; i < file.records.length; i += CHUNK) {
      const part = file.records.slice(i, i + CHUNK);
      await db.query(
        `INSERT INTO historical_interview_records
           (batch_id, record_number, row_hash, interview_date_text, candidate_name,
            contact_number, source, mode, position, original_status, remarks,
            extra_value, interview_on, review_flags)
         SELECT $1, t.record_number, t.row_hash, t.date_text, t.name, t.phone, t.source,
                t.mode, t.position, t.status, t.remarks, t.extra, t.on_date,
                COALESCE(string_to_array(NULLIF(t.flags, ''), ','), '{}')
           FROM unnest($2::int[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[],
                       $8::text[], $9::text[], $10::text[], $11::text[], $12::text[],
                       $13::date[], $14::text[])
                AS t(record_number, row_hash, date_text, name, phone, source, mode, position,
                     status, remarks, extra, on_date, flags)`,
        [
          batchId,
          part.map((r) => r.recordNumber),
          part.map((r) => r.rowHash),
          part.map((r) => textOrNull(r.interviewDateText)),
          part.map((r) => textOrNull(r.candidateName)),
          part.map((r) => textOrNull(r.contactNumber)),
          part.map((r) => textOrNull(r.source)),
          part.map((r) => textOrNull(r.mode)),
          part.map((r) => textOrNull(r.position)),
          part.map((r) => textOrNull(r.originalStatus)),
          part.map((r) => textOrNull(r.remarks)),
          part.map((r) => textOrNull(r.extraValue)),
          part.map((r) => r.interviewOn),
          part.map((r) => r.reviewFlags.join(',')),
        ],
      );
    }

    const stored = await db.query(
      `SELECT count(*)::int AS n,
              count(*) FILTER (WHERE cardinality(review_flags) > 0)::int AS review
         FROM historical_interview_records WHERE batch_id = $1`,
      [batchId],
    );
    const { n, review } = stored.rows[0];
    if (n !== file.records.length) {
      throw new HistoricalError(
        'count_mismatch',
        `Read ${file.records.length} records but stored ${n}. Nothing was saved.`,
      );
    }
    assertSameCounts(before, await tableCounts(db));

    await db.query(
      `UPDATE historical_import_batches
          SET status = 'completed', imported_count = $2, review_count = $3, completed_at = now()
        WHERE id = $1`,
      [batchId, n, review],
    );
    await recordAudit(db, {
      actorUserId: userId,
      action: 'HISTORICAL_IMPORT',
      entityType: 'historical_import_batches',
      entityId: batchId,
      details: { records: n, needingReview: review, fingerprint: file.sha256.slice(0, 16) },
    });
    return { batchId, imported: n, needingReview: review, fingerprint: file.sha256.slice(0, 16) };
  });
}

// Removes a batch's records and marks the batch rolled back. The batch row
// stays, as the record that it happened.
export async function rollbackBatch(pool, batchId, { userId = null } = {}) {
  if (!(await tablesAvailable(pool))) {
    throw new HistoricalError('not_available', 'The historical interview tables do not exist.');
  }
  return inTransaction(pool, async (db) => {
    const found = await db.query(
      'SELECT status FROM historical_import_batches WHERE id = $1 FOR UPDATE',
      [batchId],
    );
    if (found.rows.length === 0) {
      throw new HistoricalError('not_found', 'There is no such import batch.');
    }
    if (found.rows[0].status === 'rolled_back') {
      throw new HistoricalError('already_rolled_back', 'This batch is already rolled back.');
    }
    const before = await tableCounts(db);
    const removed = await db.query('DELETE FROM historical_interview_records WHERE batch_id = $1', [
      batchId,
    ]);
    await db.query(
      `UPDATE historical_import_batches
          SET status = 'rolled_back', rolled_back_at = now(), rolled_back_by = $2
        WHERE id = $1`,
      [batchId, userId],
    );
    assertSameCounts(before, await tableCounts(db));
    await recordAudit(db, {
      actorUserId: userId,
      action: 'HISTORICAL_ROLLBACK',
      entityType: 'historical_import_batches',
      entityId: batchId,
      details: { recordsRemoved: removed.rowCount },
    });
    return { batchId, removed: removed.rowCount };
  });
}
