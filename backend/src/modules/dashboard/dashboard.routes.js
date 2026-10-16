import { Router } from 'express';
import { requirePermission } from '../../middleware/auth.js';
import {
  readCounts,
  readEmployeePhases,
  readRecruitmentRecords,
  readUpcomingDeadlines,
  readUpcomingInterviews,
} from './dashboard.repository.js';

// One endpoint: everything the dashboard page shows, in one answer. Viewing
// follows the same permission as the other candidate screens. Salary does not
// exist anywhere in the schema, and no credential column is ever selected.
//
// The imported historical interview figures are included only for people who
// may see the historical records (historical.view: the Main User and HR), the
// same rule as the Recruitment Records list. They are counts, never personal
// data. Everyone else receives exactly the answer they always did.
export function dashboardRouter({ pool }) {
  const router = Router();
  const canView = requirePermission('candidates.view');

  router.get('/summary', canView, async (req, res) => {
    const withRecords = req.user.permissions.includes('historical.view');
    const [counts, employeePhases, upcomingInterviews, upcomingDeadlines, recruitmentRecords] =
      await Promise.all([
        readCounts(pool),
        readEmployeePhases(pool),
        readUpcomingInterviews(pool),
        readUpcomingDeadlines(pool),
        withRecords ? readRecruitmentRecords(pool) : null,
      ]);
    res.json({
      counts,
      employeePhases,
      upcomingInterviews,
      upcomingDeadlines,
      ...(recruitmentRecords ? { recruitmentRecords } : {}),
    });
  });

  return router;
}
