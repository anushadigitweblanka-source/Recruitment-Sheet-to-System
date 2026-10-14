# Dashboard Validation (2026-10-14)

Live verification against the running development app, fictional DASH-TEST-* data only; all test data removed afterwards.

| Check                                                          | Expected                              | Actual                                                     | Result |
| -------------------------------------------------------------- | ------------------------------------- | ---------------------------------------------------------- | ------ |
| GET /api/dashboard/summary without login                       | 401                                   | 401                                                        | PASS   |
| totalCandidates vs direct `count(*)` on dev DB                 | equal                                 | 2 = 2                                                      | PASS   |
| Create fictional candidate → totalCandidates                   | +1                                    | +1                                                         | PASS   |
| Phone-screen Selected + date → interviewsScheduled             | +1                                    | +1                                                         | PASS   |
| Fictional future interview appears in upcomingInterviews       | listed with name, interviewer, stage  | listed ("Dash Test Person", stage Interview Scheduled)     | PASS   |
| Existing active employee's evaluation deadline in 7-day window | listed, read-only                     | listed (candidate 2002's evaluation end; record untouched) | PASS   |
| Response contains salary/password/hash/token                   | never                                 | none                                                       | PASS   |
| Cleanup → totals back to baseline                              | equal                                 | equal                                                      | PASS   |
| Remaining candidates after cleanup                             | only 2002, 2003, timestamps unchanged | confirmed                                                  | PASS   |
| GET after logout                                               | 401                                   | 401                                                        | PASS   |

Automated: 8 backend dashboard tests + 6 frontend dashboard tests, all green; full suite 369 backend + 312 frontend = 681 passing, verified stable across three consecutive full backend runs after fixing a latent test race (pg_indexes view vs parallel schema drops — test-only change in candidates.test.js).

No hardcoded values: the frontend renders only `data.counts`/`data.employeePhases` from the API; the placeholder test in routes.test.jsx now asserts the loading state shows no figures.

Not validated here (mentor-blocked, excluded by design): junior end-date deadlines (date is NULL until the 9-month rule is confirmed) and any team-lead column (no team-lead record exists).
