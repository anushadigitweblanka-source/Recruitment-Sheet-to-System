import { Router } from 'express';
import { requirePermission } from '../../middleware/auth.js';
import { recordAudit } from '../audit/audit.js';

// Recruitment Records: ONE read-only list of
//   - the imported historical interview records, and
//   - the live candidates (including every candidate added with Add Candidate).
//
// It is a query over the existing tables, not a copy: candidates come from
// candidates + pipeline_status, and the history from historical_interview_
// records. A candidate is one row, so a registration cannot be duplicated, and
// the status shown is the candidate's real current stage. No interview record
// is ever created for a candidate, and nothing here writes.
//
// Needs candidates.view AND historical.view (the Main User and HR).

const NONE = '__none';

const positiveInt = (raw) => {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
};

const exact = (raw) => (typeof raw === 'string' && raw !== '' ? raw.slice(0, 200) : null);

function parseQuery(query) {
  const search = typeof query.search === 'string' ? query.search.trim().slice(0, 100) : '';
  return {
    search: search || null,
    position: exact(query.position),
    source: exact(query.source),
    status: exact(query.status),
    page: positiveInt(query.page) ?? 1,
    pageSize: Math.min(positiveInt(query.pageSize) ?? 25, 100),
  };
}

const escapeLike = (text) => text.replace(/[\\%_]/g, '\\$&');

// Both kinds of record in one shape. Live candidates carry the Candidate ID and
// are listed first (newest registration first); the history follows, newest
// interview first. The history's own text is kept exactly as imported.
const RECORDS = `
  SELECT 'candidate'::text AS kind,
         c.id AS id,
         c.candidate_code AS candidate_id,
         c.full_name AS candidate_name,
         c.phone AS contact_number,
         p.name AS position,
         s.name AS source,
         to_char(coalesce(reg.registered_at, c.created_at) AT TIME ZONE 'Asia/Colombo', 'YYYY-MM-DD') AS date_text,
         NULL::text AS mode,
         st.name AS status,
         NULL::text AS remarks,
         NULL::text AS extra_value,
         NULL::integer AS record_number,
         '{}'::text[] AS review_flags,
         0 AS kind_rank,
         coalesce(reg.registered_at, c.created_at) AS sort_at
    FROM candidates c
    JOIN pipeline_status ps ON ps.candidate_id = c.id
    JOIN pipeline_stages st ON st.code = ps.current_stage
    LEFT JOIN positions p ON p.id = c.position_id
    LEFT JOIN sources s ON s.id = c.source_id
    LEFT JOIN LATERAL (
      SELECT min(h.changed_at) AS registered_at
        FROM stage_history h
       WHERE h.candidate_id = c.id AND h.from_stage IS NULL
    ) reg ON true
  UNION ALL
  SELECT 'historical'::text,
         r.id,
         NULL::text,
         r.candidate_name,
         r.contact_number,
         r."position",
         r.source,
         r.interview_date_text,
         r.mode,
         r.original_status,
         r.remarks,
         r.extra_value,
         r.record_number,
         r.review_flags,
         1,
         r.interview_on::timestamptz
    FROM historical_interview_records r
    JOIN historical_import_batches b ON b.id = r.batch_id
   WHERE b.status = 'completed'`;

function where(filters) {
  const clauses = [];
  const params = [];
  const add = (value) => {
    params.push(value);
    return `$${params.length}`;
  };
  // Position, source and status match the whole value, ignoring case.
  const matchValue = (column, value) => {
    if (value === null) return;
    clauses.push(value === NONE ? `${column} IS NULL` : `lower(${column}) = lower(${add(value)})`);
  };

  if (filters.search) {
    const like = add(`%${escapeLike(filters.search)}%`);
    const parts = [
      `candidate_name ILIKE ${like}`,
      `candidate_id ILIKE ${like}`,
      `"position" ILIKE ${like}`,
      `source ILIKE ${like}`,
      `status ILIKE ${like}`,
      `remarks ILIKE ${like}`,
    ];
    const digits = filters.search.replace(/\D/g, '');
    if (digits.length >= 3) {
      parts.push(
        `regexp_replace(coalesce(contact_number, ''), '\\D', '', 'g') LIKE ${add(`%${digits}%`)}`,
      );
    }
    clauses.push(`(${parts.join(' OR ')})`);
  }
  matchValue('"position"', filters.position);
  matchValue('source', filters.source);
  matchValue('status', filters.status);
  return { sql: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params };
}

const toItem = (row) => ({
  kind: row.kind,
  id: Number(row.id),
  candidateId: row.candidate_id,
  candidateName: row.candidate_name,
  contactNumber: row.contact_number,
  position: row.position,
  source: row.source,
  date: row.date_text,
  mode: row.mode,
  status: row.status,
  remarks: row.remarks,
  extraValue: row.extra_value,
  recordNumber: row.record_number,
  reviewFlags: row.review_flags,
});

export function recruitmentRecordsRouter({ pool }) {
  const router = Router();
  const canView = [requirePermission('candidates.view'), requirePermission('historical.view')];

  router.get('/', ...canView, async (req, res) => {
    const filters = parseQuery(req.query);
    const { sql, params } = where(filters);

    const total = await pool.query(
      `SELECT count(*)::int AS n FROM (${RECORDS}) rec ${sql}`,
      params,
    );
    const limit = params.length + 1;
    const { rows } = await pool.query(
      `SELECT * FROM (${RECORDS}) rec ${sql}
        ORDER BY kind_rank, sort_at DESC NULLS LAST, record_number NULLS FIRST, id DESC
        LIMIT $${limit} OFFSET $${limit + 1}`,
      [...params, filters.pageSize, (filters.page - 1) * filters.pageSize],
    );

    // Which filters were used - never their values, which may be a name.
    await recordAudit(pool, {
      actorUserId: req.user.id,
      action: 'RECRUITMENT_RECORDS_VIEW',
      entityType: 'candidates',
      details: {
        filtersUsed: Object.entries({
          search: filters.search,
          position: filters.position,
          source: filters.source,
          status: filters.status,
        })
          .filter(([, value]) => value !== null)
          .map(([key]) => key),
        returned: rows.length,
        page: filters.page,
      },
    });

    res.json({
      items: rows.map(toItem),
      total: total.rows[0].n,
      page: filters.page,
      pageSize: filters.pageSize,
    });
  });

  // The values the three filters offer, taken from the records themselves.
  router.get('/options', ...canView, async (req, res) => {
    const distinct = async (column) =>
      (
        await pool.query(
          `SELECT ${column} AS value, count(*)::int AS n FROM (${RECORDS}) rec
            GROUP BY ${column} ORDER BY lower(${column}) NULLS FIRST`,
        )
      ).rows.map((row) => ({ value: row.value, count: row.n }));
    res.json({
      positions: await distinct('"position"'),
      sources: await distinct('source'),
      statuses: await distinct('status'),
    });
  });

  return router;
}
