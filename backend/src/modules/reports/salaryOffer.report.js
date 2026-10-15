// The Salary and Offer report from the task guide: "Offered salary per
// position and offer status (Main User only)".
//
// Salary lives only in offer_salary (migration 011). This is the one report
// that reads it, so it is kept apart from reports.repository.js, whose
// queries never select salary, and it is mounted only behind salary.view,
// which only the Main User holds. Every view and every export is written to
// the audit log - the fact, the person and the filters, never an amount.
//
// Rows are offers. Offers without a salary entered yet are listed with an
// empty salary and are left out of the figures (offers vs priced offers).

import { recordAudit } from '../audit/audit.js';
import { RENDERERS, exportFilename } from './reports.export.js';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const OFFER_STATUSES = ['sent', 'accepted', 'pending'];
const EXPORT_ROW_LIMIT = 10000;

const positiveInt = (raw) => {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
};
const isoDate = (raw) => (typeof raw === 'string' && ISO_DATE.test(raw) ? raw : null);

export function parseSalaryOfferQuery(query) {
  return {
    positionId: positiveInt(query.positionId),
    sourceId: positiveInt(query.sourceId),
    // 'pending' is an offer that has not been sent yet (no status).
    offerStatus: OFFER_STATUSES.includes(query.offerStatus) ? query.offerStatus : null,
    from: isoDate(query.from),
    to: isoDate(query.to),
    page: positiveInt(query.page) ?? 1,
    pageSize: Math.min(positiveInt(query.pageSize) ?? 20, 100),
  };
}

function whereFor(filters) {
  const where = [];
  const params = [];
  const add = (value) => {
    params.push(value);
    return `$${params.length}`;
  };
  if (filters.positionId) where.push(`o.position_id = ${add(filters.positionId)}`);
  if (filters.sourceId) where.push(`c.source_id = ${add(filters.sourceId)}`);
  if (filters.offerStatus === 'pending') where.push('o.offer_status IS NULL');
  else if (filters.offerStatus) where.push(`o.offer_status = ${add(filters.offerStatus)}`);
  if (filters.from) where.push(`o.offer_date >= ${add(filters.from)}::date`);
  if (filters.to) where.push(`o.offer_date <= ${add(filters.to)}::date`);
  return { whereSql: where.length > 0 ? `WHERE ${where.join(' AND ')}` : '', params };
}

const FROM = `FROM offers o
    JOIN candidates c ON c.id = o.candidate_id
    JOIN positions p ON p.id = o.position_id
    LEFT JOIN sources src ON src.id = c.source_id
    LEFT JOIN offer_salary s ON s.candidate_id = o.candidate_id`;

const money = (value) => (value === null || value === undefined ? null : Number(value));

export async function salaryOfferReport(db, filters, { all = false } = {}) {
  const { whereSql, params } = whereFor(filters);

  const groups = await db.query(
    `SELECT p.name AS position, o.offer_status,
            count(*)::int AS offers,
            count(s.id)::int AS priced,
            min(s.salary_lkr) AS lowest,
            round(avg(s.salary_lkr), 2) AS average,
            max(s.salary_lkr) AS highest,
            COALESCE(sum(s.salary_lkr), 0) AS total
       ${FROM} ${whereSql}
      GROUP BY p.name, o.offer_status
      ORDER BY p.name, o.offer_status NULLS FIRST`,
    params,
  );

  const total = await db.query(`SELECT count(*)::int AS total ${FROM} ${whereSql}`, params);

  const listParams = [...params];
  let paging;
  if (all) {
    listParams.push(EXPORT_ROW_LIMIT);
    paging = `LIMIT $${listParams.length}`;
  } else {
    listParams.push(filters.pageSize, (filters.page - 1) * filters.pageSize);
    paging = `LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`;
  }
  const { rows } = await db.query(
    `SELECT o.id, c.candidate_code, c.full_name, p.name AS position, src.name AS source,
            o.offer_status, to_char(o.offer_date, 'YYYY-MM-DD') AS offer_date, s.salary_lkr
       ${FROM} ${whereSql}
      ORDER BY p.name, o.offer_status NULLS FIRST, c.candidate_code
      ${paging}`,
    listParams,
  );

  return {
    total: total.rows[0].total,
    groups: groups.rows.map((row) => ({
      position: row.position,
      offerStatus: row.offer_status,
      offers: row.offers,
      priced: row.priced,
      lowest: money(row.lowest),
      average: money(row.average),
      highest: money(row.highest),
      total: money(row.total),
    })),
    items: rows.map((row) => ({
      id: Number(row.id),
      candidateCode: row.candidate_code,
      fullName: row.full_name,
      position: row.position,
      source: row.source,
      offerStatus: row.offer_status,
      offerDate: row.offer_date,
      salaryLkr: money(row.salary_lkr),
    })),
  };
}

const usedFilters = (pairs) =>
  pairs.filter(([, value]) => value).map(([label, value]) => `${label}: ${value}`);

const STATUS_LABELS = { sent: 'Sent', accepted: 'Accepted' };
const statusLabel = (status) => STATUS_LABELS[status] ?? 'Not sent';
const DATE = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});
const dateText = (iso) => (iso ? DATE.format(new Date(`${iso}T00:00:00Z`)) : '');

export async function buildSalaryOfferExport(db, query) {
  const filters = parseSalaryOfferQuery(query);
  const data = await salaryOfferReport(db, filters, { all: true });
  return {
    title: 'Salary and Offer Report (Main User only)',
    filters: usedFilters([
      ['Position ID', filters.positionId],
      ['Source ID', filters.sourceId],
      ['Offer status', filters.offerStatus],
      ['Offer date from', filters.from],
      ['Offer date to', filters.to],
    ]),
    columns: [
      { key: 'candidateCode', label: 'Candidate ID', width: 16 },
      { key: 'fullName', label: 'Name', width: 28 },
      { key: 'position', label: 'Position', width: 24 },
      { key: 'offerStatus', label: 'Offer Status', width: 14 },
      { key: 'offerDate', label: 'Offer Date', width: 14 },
      { key: 'salaryLkr', label: 'Offered Salary (LKR)', width: 20 },
    ],
    rows: data.items.map((row) => ({
      candidateCode: row.candidateCode,
      fullName: row.fullName,
      position: row.position,
      offerStatus: statusLabel(row.offerStatus),
      offerDate: dateText(row.offerDate),
      salaryLkr: row.salaryLkr === null ? 'Not set' : row.salaryLkr.toFixed(2),
    })),
    generatedAt: new Date(),
    filterValues: filters,
  };
}

// Mounted by reports.routes.js behind requirePermission('salary.view').
export function mountSalaryOfferRoutes(router, { pool, guard }) {
  // The filters are audited as given; no amount is ever part of the details.
  const auditFilters = (f) => ({
    positionId: f.positionId,
    sourceId: f.sourceId,
    offerStatus: f.offerStatus,
    from: f.from,
    to: f.to,
  });

  router.get('/salary-offers', guard, async (req, res) => {
    const filters = parseSalaryOfferQuery(req.query);
    const data = await salaryOfferReport(pool, filters);
    await recordAudit(pool, {
      actorUserId: req.user.id,
      action: 'SALARY_REPORT_VIEW',
      entityType: 'report',
      details: { report: 'salary-offers', rows: data.items.length, filters: auditFilters(filters) },
    });
    res.json({ ...data, page: filters.page, pageSize: filters.pageSize });
  });

  router.get('/salary-offers/export', guard, async (req, res) => {
    const format = Object.keys(RENDERERS).includes(req.query.format) ? req.query.format : null;
    if (!format) {
      return res.status(404).json({
        error: 'not_found',
        message: `Unknown format. Formats: ${Object.keys(RENDERERS).join(', ')}.`,
      });
    }
    const data = await buildSalaryOfferExport(pool, req.query);
    const file = await RENDERERS[format].render(data);
    await recordAudit(pool, {
      actorUserId: req.user.id,
      action: 'SALARY_REPORT_EXPORT',
      entityType: 'report',
      details: {
        report: 'salary-offers',
        format,
        rows: data.rows.length,
        filters: auditFilters(data.filterValues),
      },
    });
    res.setHeader('Content-Type', RENDERERS[format].contentType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${exportFilename('salary-offers', format)}"`,
    );
    res.send(file);
  });
}
