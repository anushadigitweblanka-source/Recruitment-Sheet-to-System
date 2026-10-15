# Reports (built 2026-10-14, uncommitted pending review)

Seven read-only, on-screen reports at `/reports` (one page, tabbed). Every figure is queried from the database on load — nothing is hardcoded. Reports can be exported in Excel, CSV, or PDF. Stage 11 also sends the weekly report on Monday at 08:00 Asia/Colombo when recipients are configured.

## Endpoints and permission

All under `GET /api/reports/*`, behind sign-in, requiring `candidates.view` (401 unauthenticated, 403 without permission, backend-enforced). Backend module: `backend/src/modules/reports/` (routes, repository, validation).

## Query basis per report

| Report           | Endpoint            | Basis                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ---------------- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Candidate status | `/candidate-status` | candidates joined with `pipeline_status` (one row per candidate); filters: current stage, position, source, date-added range (Colombo calendar days on `created_at`); paged, newest first                                                                                                                                                                                                                                              |
| Funnel           | `/funnel`           | per pipeline stage in sort order: candidates there **now** (`pipeline_status`) and candidates who **entered** the stage in the chosen period (`stage_history.to_stage` by `changed_at` Colombo day)                                                                                                                                                                                                                                    |
| Sources          | `/sources`          | per source (plus "(not recorded)"): total + outcome buckets from the current stage — joined / rejected / on hold / no-show-or-no-response / in progress; each candidate lands in exactly one bucket                                                                                                                                                                                                                                    |
| Positions        | `/positions`        | same breakdown per position                                                                                                                                                                                                                                                                                                                                                                                                            |
| Weekly           | `/weekly`           | the chosen Monday-to-Sunday week in **Asia/Colombo** (default: last completed week; `weekStart` must be a Monday or it falls back). Applications = candidates **added** in the week (`created_at` — the only date available until the proposed `applied_on` column is approved; documented limitation). Movements = `stage_history` rows in the week, grouped by `to_stage`, with offers sent/accepted, joined and rejected called out |
| Onboarding       | `/onboarding`       | employees joined with candidates/positions, filtered on `join_date` range, with track, current phase and status                                                                                                                                                                                                                                                                                                                        |
| Exit             | `/exit`             | employees with status discontinued or terminated, with `exit_date` and `exit_reason`, filtered on exit date                                                                                                                                                                                                                                                                                                                            |

All date comparisons use `(timestamp AT TIME ZONE 'Asia/Colombo')::date`, so week and range boundaries follow the office calendar, not the server's zone.

## Frontend

`frontend/src/modules/reports/ReportsPage.jsx` + `api.js`; the existing `/reports` sidebar entry now opens it (placeholder removed). Each tab has its filters (stage/position/source selects from the lookups API, date fields), loading/error (with retry)/empty states, Asia/Colombo date formatting, and pagination on the status report.

## Known limits

- **Weekly email recipients**: configure the `weekly_report_recipients` setting before scheduled delivery. With no recipients configured, no email is sent.
- **Applications count**: uses the date the candidate was added; the workbook's true application date needs the approved `applied_on` migration.
- The reports do not expose salary values.

## Tests

`backend/tests/reports.test.js` (11): 401 on all seven endpoints, 403 without permission, status filters (stage/position/source/date), funnel current-vs-entered with in/out-of-range movements, source/position outcome buckets, Monday validation + previous-week calculation + Colombo week boundaries (Mon 00:10 and Sun 23:50 in, the hour before Monday out), onboarding range, exit-only listing with reason, and a no-sensitive-words sweep. `frontend/tests/reports.test.jsx` (5): default tab render, filter → refetch with query, weekly figures, empty states, error + retry.
