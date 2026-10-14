import { Router } from 'express';
import { requirePermission } from '../../middleware/auth.js';
import {
  candidateStatusReport,
  exitReport,
  funnelReport,
  onboardingReport,
  positionReport,
  sourceReport,
  weeklyReport,
} from './reports.repository.js';
import { parseRangeQuery, parseStatusQuery, parseWeeklyQuery } from './reports.validation.js';
import {
  buildExportData,
  EXPORT_FORMATS,
  EXPORT_REPORTS,
  exportFilename,
  RENDERERS,
} from './reports.export.js';

// Read-only reports. Viewing follows the same permission as the other
// candidate screens. Exports and the scheduled weekly email are not built
// yet; the weekly figures here are the on-screen version only.
export function reportsRouter({ pool }) {
  const router = Router();
  const canView = requirePermission('candidates.view');

  router.get('/candidate-status', canView, async (req, res) => {
    const filters = parseStatusQuery(req.query);
    const { items, total } = await candidateStatusReport(pool, filters);
    res.json({ items, total, page: filters.page, pageSize: filters.pageSize });
  });

  router.get('/funnel', canView, async (req, res) => {
    const range = parseRangeQuery(req.query);
    res.json({ ...range, stages: await funnelReport(pool, range) });
  });

  router.get('/sources', canView, async (req, res) => {
    res.json({ items: await sourceReport(pool) });
  });

  router.get('/positions', canView, async (req, res) => {
    res.json({ items: await positionReport(pool) });
  });

  router.get('/weekly', canView, async (req, res) => {
    res.json(await weeklyReport(pool, parseWeeklyQuery(req.query)));
  });

  router.get('/onboarding', canView, async (req, res) => {
    res.json({ items: await onboardingReport(pool, parseRangeQuery(req.query)) });
  });

  router.get('/exit', canView, async (req, res) => {
    res.json({ items: await exitReport(pool, parseRangeQuery(req.query)) });
  });

  // One export route for every report: /reports/:report/export?format=xlsx.
  // The dataset is built by the same functions and filters as the screen, so
  // the file always matches the filtered on-screen report.
  router.get('/:report/export', canView, async (req, res) => {
    const report = EXPORT_REPORTS.includes(req.params.report) ? req.params.report : null;
    const format = EXPORT_FORMATS.includes(req.query.format) ? req.query.format : null;
    if (!report || !format) {
      return res.status(404).json({
        error: 'not_found',
        message: `Unknown report or format. Reports: ${EXPORT_REPORTS.join(', ')}. Formats: ${EXPORT_FORMATS.join(', ')}.`,
      });
    }

    const data = await buildExportData(pool, report, req.query);
    const renderer = RENDERERS[format];
    const file = await renderer.render(data);
    res.setHeader('Content-Type', renderer.contentType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${exportFilename(report, format)}"`,
    );
    res.send(file);
  });

  return router;
}
