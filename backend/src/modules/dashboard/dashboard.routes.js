import { Router } from 'express';
import { requirePermission } from '../../middleware/auth.js';
import {
  readCounts,
  readEmployeePhases,
  readUpcomingDeadlines,
  readUpcomingInterviews,
} from './dashboard.repository.js';

// One endpoint: everything the dashboard page shows, in one answer. Viewing
// follows the same permission as the other candidate screens. Salary does not
// exist anywhere in the schema, and no credential column is ever selected.
export function dashboardRouter({ pool }) {
  const router = Router();
  const canView = requirePermission('candidates.view');

  router.get('/summary', canView, async (req, res) => {
    const [counts, employeePhases, upcomingInterviews, upcomingDeadlines] = await Promise.all([
      readCounts(pool),
      readEmployeePhases(pool),
      readUpcomingInterviews(pool),
      readUpcomingDeadlines(pool),
    ]);
    res.json({ counts, employeePhases, upcomingInterviews, upcomingDeadlines });
  });

  return router;
}
