# Dashboard (built 2026-10-14, uncommitted pending review)

The dashboard shows live figures read from the database on every page load. Nothing is hardcoded: zero means the query returned zero, and the same queries will serve real company data unchanged once it is imported.

## Endpoint and permission

`GET /api/dashboard/summary` — one endpoint for the whole page, mounted behind sign-in like every API route. Viewing requires `candidates.view` (the same permission as the other candidate screens), enforced in the backend: 401 without a session, 403 without the permission. The UI is never the only protection.

## Metric definitions (query basis)

| Figure                                                                                                                                            | Source                                                                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| totalCandidates                                                                                                                                   | `count(*)` of `candidates`                                                                                                                                                                                  |
| applied, phoneScreened, interviewsScheduled, interviewed, selected, rejected, onHold, offersSent, offersAccepted, joined, notAttended, noResponse | `pipeline_status.current_stage` grouped — one row per candidate (PK `candidate_id`), so each candidate is counted once, in the stage they are in **now**; `stage_history` rows are deliberately not counted |
| currentlyWorking / discontinued / terminated                                                                                                      | `employees.status` grouped                                                                                                                                                                                  |
| employeePhases (evaluation/probation/junior/senior)                                                                                               | **active** employees grouped by `employees.current_phase` — the copy Module 5 keeps in step with `phase_history`, so historical phase rows never count as current                                           |

## Upcoming interviews

Direct interviews with `scheduled_at >= now()`, nearest first, limited to 10. Fields exposed: candidate code and name, position, date/time, interviewer, current stage — nothing else (salary is stored separately and never selected here; no credentials are selected, covered by a response scan test).

## Upcoming deadlines

Active employees whose **stored** `phase_end` falls within the next 7 days (`current_date` to `current_date + 7`), soonest first, with `daysRemaining = phase_end − current_date`. The dates are the ones Module 5's approved calculations wrote — nothing is recalculated here.

## Mentor-dependent limitations

- A **junior** whose end date awaits the 9-month confirmation has `phase_end NULL` and is simply excluded from deadlines — no date is invented. The page's empty-state text says so.
- **Senior** has no end date by design and never appears as a deadline.
- "Upcoming Reviews"-style team-lead information (the old placeholder column) is not shown: no team-lead record exists yet (mentor decision).

## Frontend

`frontend/src/pages/DashboardPage.jsx`: Recruitment Summary (10 cards), Employee Lifecycle (4 phase + 3 employment cards), Upcoming Interviews table, Upcoming Deadlines table. States: loading spinner, error with Try again, explicit empty messages for both tables, and real zeros. Dates render in Asia/Colombo via the shared formatters.

## Tests

`backend/tests/dashboard.test.js` (8 tests): 401/403, all-zero empty database, single-count-per-candidate with a noisy stage history, active-only phase counts, interview ordering/limit/past-exclusion/safe-fields, 7-day window with outside/null-junior/senior exclusions, and the no-sensitive-words sweep. `frontend/tests/dashboard.test.jsx` (6 tests): loading, counts render, zeros (no "--", no sample numbers), tables render, empty states, error + retry. One legacy placeholder test in `routes.test.jsx` was updated (the dashboard is now connected), and a latent catalog-view race in `candidates.test.js` exposed by the new parallel test file was fixed (pg_index direct query instead of the pg_indexes view).
