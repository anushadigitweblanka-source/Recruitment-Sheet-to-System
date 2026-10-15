# Reports Validation (2026-10-14)

Live verification against the running development app, fictional RPT-TEST-* data only; all test data removed afterwards.

| Check                                                            | Expected                              | Actual                                                   | Result |
| ---------------------------------------------------------------- | ------------------------------------- | -------------------------------------------------------- | ------ |
| GET /api/reports/weekly without login                            | 401                                   | 401                                                      | PASS   |
| Candidate-status total vs direct `count(*)`                      | equal                                 | 2 = 2                                                    | PASS   |
| Fictional rejected candidate appears under stage=rejected filter | listed                                | listed                                                   | PASS   |
| Funnel "rejected: current" vs direct DB count                    | equal                                 | 1 = 1                                                    | PASS   |
| Sources report shape                                             | name + count buckets only             | name,total,hired,rejected,onHold,unresponsive,inProgress | PASS   |
| Weekly default window (run on Wed 2026-10-14)                    | last completed Mon–Sun                | 2026-10-05 → 2026-10-11                                  | PASS   |
| Onboarding / exit rows reflect DB                                | 1 / 0                                 | 1 / 0                                                    | PASS   |
| Any report contains salary/password/hash/token                   | never                                 | none                                                     | PASS   |
| Cleanup → totals back to baseline                                | equal                                 | equal                                                    | PASS   |
| Remaining candidates                                             | only 2002, 2003, timestamps unchanged | confirmed                                                | PASS   |

Automated: 11 backend + 5 frontend report tests green; full suite **380 backend + 317 frontend = 697 passing**; build/lint/format clean. Week-boundary correctness (Colombo Mon 00:10 / Sun 23:50 in, previous Sunday 23:50 out; next-week movement excluded) is covered by the automated tests on an isolated fixture week.

> Historical validation note from before the export and Stage 11 work. Exports and scheduled weekly email are implemented; weekly Applications still uses candidate creation date until an `applied_on` migration is approved. See `report-exports-validation.md` and `stage11-mentor-blocked-readiness.md` for current status.
