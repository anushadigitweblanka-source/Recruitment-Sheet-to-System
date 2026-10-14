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

  return router;
}
