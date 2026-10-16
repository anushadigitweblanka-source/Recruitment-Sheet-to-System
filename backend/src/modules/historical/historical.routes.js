import { Router } from 'express';
import { requirePermission } from '../../middleware/auth.js';
import { recordAudit } from '../audit/audit.js';
import { REVIEW_FLAG_CODES } from './review.js';
import { tablesAvailable } from './importer.js';

// The imported historical interview log, read only. Every route needs
// historical.view (the Main User and HR) and answers 503 "not available" until
// migration 015 has created the tables, so the page can say so.
//
// Nothing here can change a record: there is no write route. Importing and
// rolling back are done from the command line (scripts/import-historical.js).

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const positiveInt = (raw) => {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
};

function parseQuery(query) {
  const text = (v) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 100) : null);
  return {
    search: text(query.search),
    status: typeof query.status === 'string' ? query.status.slice(0, 200) : null,
    source: typeof query.source === 'string' ? query.source.slice(0, 200) : null,
    mode: typeof query.mode === 'string' ? query.mode.slice(0, 100) : null,
    position: typeof query.position === 'string' ? query.position.slice(0, 200) : null,
    review: query.review === 'true',
    flag: REVIEW_FLAG_CODES.includes(query.flag) ? query.flag : null,
    batchId: positiveInt(query.batchId),
    dateFrom: ISO_DATE.test(query.dateFrom ?? '') ? query.dateFrom : null,
    dateTo: ISO_DATE.test(query.dateTo ?? '') ? query.dateTo : null,
    page: positiveInt(query.page) ?? 1,
    pageSize: Math.min(positiveInt(query.pageSize) ?? 25, 100),
  };
}

// '(none)' is the filter value for an empty cell.
const NONE = '__none';

function where(filters) {
  const clauses = [`b.status = 'completed'`];
  const params = [];
  const add = (value) => {
    params.push(value);
    return `$${params.length}`;
  };
  const exactOrNone = (column, value) => {
    if (value === null || value === '') return;
    clauses.push(value === NONE ? `r.${column} IS NULL` : `r.${column} = ${add(value)}`);
  };

  if (filters.search) {
    const like = add(`%${filters.search.replace(/[\\%_]/g, '\\$&')}%`);
    const digits = filters.search.replace(/\D/g, '');
    const parts = [
      `r.candidate_name ILIKE ${like}`,
      `r.position ILIKE ${like}`,
      `r.source ILIKE ${like}`,
      `r.remarks ILIKE ${like}`,
      `r.original_status ILIKE ${like}`,
    ];
    if (digits.length >= 3) {
      parts.push(
        `regexp_replace(coalesce(r.contact_number, ''), '\\D', '', 'g') LIKE ${add(`%${digits}%`)}`,
      );
    }
    clauses.push(`(${parts.join(' OR ')})`);
  }
  exactOrNone('original_status', filters.status);
  exactOrNone('source', filters.source);
  exactOrNone('mode', filters.mode);
  exactOrNone('position', filters.position);
  if (filters.review) clauses.push('cardinality(r.review_flags) > 0');
  if (filters.flag) clauses.push(`${add(filters.flag)} = ANY (r.review_flags)`);
  if (filters.batchId) clauses.push(`r.batch_id = ${add(filters.batchId)}`);
  if (filters.dateFrom) clauses.push(`r.interview_on >= ${add(filters.dateFrom)}::date`);
  if (filters.dateTo) clauses.push(`r.interview_on <= ${add(filters.dateTo)}::date`);
  return { sql: `WHERE ${clauses.join(' AND ')}`, params };
}

const FROM = `FROM historical_interview_records r
  JOIN historical_import_batches b ON b.id = r.batch_id`;

const toItem = (row) => ({
  id: Number(row.id),
  batchId: Number(row.batch_id),
  recordNumber: row.record_number,
  interviewDateText: row.interview_date_text,
  interviewOn: row.interview_on,
  candidateName: row.candidate_name,
  contactNumber: row.contact_number,
  source: row.source,
  mode: row.mode,
  position: row.position,
  originalStatus: row.original_status,
  remarks: row.remarks,
  extraValue: row.extra_value,
  reviewFlags: row.review_flags,
});

export function historicalRouter({ pool }) {
  const router = Router();
  const canView = requirePermission('historical.view');

  // Every route first checks that the tables exist.
  router.use(canView, async (req, res, next) => {
    if (await tablesAvailable(pool)) return next();
    return res.status(503).json({
      error: 'not_available',
      message: 'Historical interview records are not enabled in this database yet.',
    });
  });

  router.get('/', async (req, res) => {
    const filters = parseQuery(req.query);
    const { sql, params } = where(filters);

    const total = await pool.query(`SELECT count(*)::int AS n ${FROM} ${sql}`, params);
    const limit = params.length + 1;
    const { rows } = await pool.query(
      `SELECT r.id, r.batch_id, r.record_number, r.interview_date_text, r.interview_on,
              to_char(r.interview_on, 'YYYY-MM-DD') AS interview_on_text,
              r.candidate_name, r.contact_number, r.source, r.mode, r.position,
              r.original_status, r.remarks, r.extra_value, r.review_flags
         ${FROM} ${sql}
        ORDER BY r.interview_on DESC NULLS LAST, r.record_number
        LIMIT $${limit} OFFSET $${limit + 1}`,
      [...params, filters.pageSize, (filters.page - 1) * filters.pageSize],
    );

    // Which filters were used - never their values, which may be a name.
    await recordAudit(pool, {
      actorUserId: req.user.id,
      action: 'HISTORICAL_VIEW',
      entityType: 'historical_interview_records',
      details: {
        filtersUsed: Object.entries({
          search: filters.search,
          status: filters.status,
          source: filters.source,
          mode: filters.mode,
          position: filters.position,
          review: filters.review || null,
          flag: filters.flag,
          batchId: filters.batchId,
          dateFrom: filters.dateFrom,
          dateTo: filters.dateTo,
        })
          .filter(([, value]) => value !== null && value !== '')
          .map(([key]) => key),
        returned: rows.length,
        page: filters.page,
      },
    });

    res.json({
      items: rows.map((row) => ({ ...toItem(row), interviewOn: row.interview_on_text })),
      total: total.rows[0].n,
      page: filters.page,
      pageSize: filters.pageSize,
    });
  });

  router.get('/summary', async (req, res) => {
    const { rows } = await pool.query(
      `SELECT count(*)::int AS records,
              count(*) FILTER (WHERE cardinality(r.review_flags) > 0)::int AS needing_review,
              count(DISTINCT r.batch_id)::int AS batches,
              min(r.interview_on) AS first_date, max(r.interview_on) AS last_date
         ${FROM} WHERE b.status = 'completed'`,
    );
    const batches = await pool.query(
      `SELECT id, file_name, record_count, imported_count, review_count, completed_at
         FROM historical_import_batches WHERE status = 'completed' ORDER BY id DESC`,
    );
    res.json({
      records: rows[0].records,
      needingReview: rows[0].needing_review,
      batches: batches.rows.map((b) => ({
        id: Number(b.id),
        fileName: b.file_name,
        recordCount: b.record_count,
        importedCount: b.imported_count,
        reviewCount: b.review_count,
        completedAt: b.completed_at,
      })),
    });
  });

  // The values the filters offer, taken from the stored data.
  router.get('/options', async (req, res) => {
    // Optionally only the records with one exact original status, so a screen
    // that shows just those records offers counts that match what it lists.
    const status =
      typeof req.query.status === 'string' && req.query.status !== ''
        ? req.query.status.slice(0, 200)
        : null;
    const only = status === null ? '' : 'AND r.original_status = $1';
    const params = status === null ? [] : [status];
    const distinct = async (column) =>
      (
        await pool.query(
          `SELECT r.${column} AS value, count(*)::int AS n ${FROM}
            WHERE b.status = 'completed' ${only}
            GROUP BY r.${column} ORDER BY r.${column} NULLS FIRST`,
          params,
        )
      ).rows.map((row) => ({ value: row.value, count: row.n }));
    const flags = await pool.query(
      `SELECT f AS flag, count(*)::int AS n
         FROM historical_interview_records r JOIN historical_import_batches b ON b.id = r.batch_id,
              unnest(r.review_flags) f
        WHERE b.status = 'completed' ${only} GROUP BY f ORDER BY f`,
      params,
    );
    res.json({
      statuses: await distinct('original_status'),
      sources: await distinct('source'),
      modes: await distinct('mode'),
      positions: await distinct('position'),
      flags: flags.rows.map((row) => ({ flag: row.flag, count: row.n })),
    });
  });

  return router;
}
