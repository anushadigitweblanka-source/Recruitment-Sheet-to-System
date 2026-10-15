# Final Dummy-Data Acceptance Report (2026-10-14)

> Historical snapshot from before Stage 11 implementation. Its BLOCKED and NOT APPLICABLE results describe the 2026-10-14 application only; use `final-acceptance-checklist.md` and `stage11-mentor-blocked-readiness.md` for current implementation status.

Acceptance-tested against the running development application (backend API, dev database) using a dedicated fictional dataset only: candidates TEST-ACCEPT-001/002/003 (Test Candidate Alpha/Beta/Gamma, example.test emails, fake 0770000xxx phones, "TEST-ACCEPT Position/Source" lookups, viewer@example.test test user). Candidates 2002 and 2003 were snapshot before and verified byte-identical after. All test data was removed afterwards.

Verdicts: PASS / FAIL / BLOCKED (exact mentor decision named) / NOT APPLICABLE (feature not built yet, by design).

## Authentication

| Check                                                                           | Verdict |
| ------------------------------------------------------------------------------- | ------- |
| Protected route without login returns 401                                       | PASS    |
| Invalid login rejected (401)                                                    | PASS    |
| Valid login works (session cookie)                                              | PASS    |
| Wrong password rejected                                                         | PASS    |
| Logout works (204)                                                              | PASS    |
| Session invalid after logout — request after logout gets 401                    | PASS    |
| Back button cannot replay data: every API response is `Cache-Control: no-store` | PASS    |
| Role checks enforced in backend (see Roles section)                             | PASS    |

## Candidate Management

| Check                                                                                       | Verdict |
| ------------------------------------------------------------------------------------------- | ------- |
| Add candidate                                                                               | PASS    |
| Required-field validation (name missing → 422)                                              | PASS    |
| Numeric phone rejected ("must be sent as text")                                             | PASS    |
| Phone stored as text, leading zero kept, separators cleaned ("077 000 0111" → "0770000111") | PASS    |
| Invalid email rejected                                                                      | PASS    |
| Position/source lookup (admin-managed lists)                                                | PASS    |
| Duplicate Candidate ID refused (hard unique, 422)                                           | PASS    |
| Duplicate phone warning (409 possible_duplicate with matches)                               | PASS    |
| Duplicate email warning (case-insensitive)                                                  | PASS    |
| Duplicate name + position warning                                                           | PASS    |
| Edit candidate                                                                              | PASS    |
| Candidate details page/API                                                                  | PASS    |
| New candidate starts at Applied; stage history rows written                                 | PASS    |
| Search/list/filter finds test candidates                                                    | PASS    |

## Phone Interview

| Check                                                   | Verdict                                                                                                                                                                    |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Record phone interview (Called, Result, interview date) | PASS                                                                                                                                                                       |
| `response` field                                        | **BLOCKED — mentor decision 6**: the app refuses every value with "Response values have not been approved yet, so none can be saved" (correct guard, no behavior invented) |
| Selected + interview date → stage Interview Scheduled   | PASS                                                                                                                                                                       |
| Not Selected requires a rejection reason (422 without)  | PASS                                                                                                                                                                       |
| Not Selected → stage Rejected                           | PASS                                                                                                                                                                       |
| Stage history created for every change                  | PASS                                                                                                                                                                       |

## Direct Interview

| Check                                                                       | Verdict                                                                                             |
| --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Interview requires candidate at Interview Scheduled (earlier stage refused) | PASS                                                                                                |
| Score above 10 rejected                                                     | PASS                                                                                                |
| All-five-or-none score rule                                                 | PASS                                                                                                |
| Record with five scores (8,7,9,8,8)                                         | PASS                                                                                                |
| Total auto-calculated by database: 40/50                                    | PASS                                                                                                |
| Selected → stage Selected                                                   | PASS                                                                                                |
| On Hold requires hold reason (422 without)                                  | PASS                                                                                                |
| On Hold (with reason + follow-up date) → stage On Hold                      | PASS                                                                                                |
| Not Selected decision path                                                  | PASS (same validation family; rejection-reason rule verified at phone stage and by automated suite) |

## Offer Management

| Check                                                                 | Verdict                                                                       |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Offer requires interview result Selected (earlier stage refused)      | PASS                                                                          |
| Unapproved work mode rejected (only `office` exists, migration 007)   | PASS                                                                          |
| Create offer (position, offer date, work mode, location, status Sent) | PASS                                                                          |
| Status Sent → stage Offer Sent                                        | PASS                                                                          |
| Accepted + onboarding date → stage Offer Accepted                     | PASS                                                                          |
| Attended = Yes → stage Joined, employee auto-created                  | PASS                                                                          |
| Salary                                                                | NOT APPLICABLE — not implemented anywhere, awaiting mentor approval (correct) |

## Employee Lifecycle

| Check                                                                                                            | Verdict                                                                                           |
| ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Employee auto-created on Attended = Yes                                                                          | PASS                                                                                              |
| Starts in Evaluation                                                                                             | PASS                                                                                              |
| Evaluation dates: 7-day phase counted inclusively (ends join_date + 6, per documented rule in lifecycleDates.js) | PASS                                                                                              |
| Evaluation Pass → Probation created (3 months, EDATE − 1 day)                                                    | PASS                                                                                              |
| Probation Extend requires explicit new end date, capped at +1 month                                              | PASS (validation verified live; full extend flow covered by automated suite)                      |
| Probation Pass → Junior created                                                                                  | PASS                                                                                              |
| Junior end date NOT calculated                                                                                   | PASS — correctly **BLOCKED — mentor decision 5** (9-month rule unconfirmed); phase_end stays null |
| phase_history records every phase (evaluation→probation→junior)                                                  | PASS                                                                                              |
| Invalid decision for phase rejected (extend on junior → 422)                                                     | PASS                                                                                              |
| Termination after probation (valid exit date) works; exit date before join refused                               | PASS                                                                                              |
| Discontinue flow                                                                                                 | PASS (validation requires reason + exit date; covered by automated suite)                         |
| No duplicate phase creation                                                                                      | PASS (one row per phase in history)                                                               |

## Notifications

| Check                                                                                                     | Verdict                                                                         |
| --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Create editable email template (placeholders {name}, {candidate_code})                                    | PASS                                                                            |
| Edit template                                                                                             | PASS                                                                            |
| Eligibility rule: send_at <= now AND sent_at IS NULL — eligible row sent, future row stays pending        | PASS                                                                            |
| 24-hour rule data model (due_at deadline, send_at = due − 24 h) honored by constraint `send_at <= due_at` | PASS                                                                            |
| Development mail adapter only; run reports `mode: "development"`; no external mail                        | PASS                                                                            |
| Sent row marked sent with sent_at; email_log records the attempt                                          | PASS                                                                            |
| Duplicate send prevented: same template to same candidate refused ("Use Resend")                          | PASS                                                                            |
| Explicit resend creates its own `is_resend` log row                                                       | PASS                                                                            |
| Manual development trigger POST /notifications/run works (and is refused in production by code)           | PASS                                                                            |
| Automatic notification creation                                                                           | BLOCKED — mentor decision: recipients per reminder type undefined (Module 6 Q1) |
| Retry policy / template-type list / manual send_mode / cv_pending trigger                                 | BLOCKED — Module 6 mentor questions 2–5; no behavior invented                   |

## Dashboard

NOT APPLICABLE — the dashboard page is an explicit placeholder ("No figures are shown until they can be read from the database"); no metric queries exist yet, so there are no hardcoded fake numbers (verified in DashboardPage.jsx). Nothing to acceptance-test.

## Reports

NOT APPLICABLE — no reports module exists (no routes, no pages). Candidate status / weekly / funnel / source / onboarding / exit reports are future work.

## Exports

NOT APPLICABLE — no Excel/CSV/PDF export feature exists.

## Weekly Report

NOT APPLICABLE — not implemented; its recipient configuration is additionally blocked by the Module 6 recipient decision.

## Roles / Permissions

| Check                                                                           | Verdict                                                                                                         |
| ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Restricted test user (candidates.view only) can sign in and read candidates     | PASS                                                                                                            |
| Create candidate denied without candidates.edit (403, backend-enforced)         | PASS                                                                                                            |
| Email-template create denied without notifications.manage (403)                 | PASS                                                                                                            |
| Lookup admin denied without admin.manage (403)                                  | PASS                                                                                                            |
| Employee decision denied without employees.manage (403)                         | PASS                                                                                                            |
| UI hiding is not the only protection (all checks done directly against the API) | PASS                                                                                                            |
| HR / Team lead / Intern roles                                                   | BLOCKED — mentor decision 7 (final role list); only main_user is seeded, custom roles work via role_permissions |
| Salary leakage                                                                  | NOT APPLICABLE — no salary data exists to leak (permission codes exist, feature does not)                       |

## Security

| Check                                                                    | Verdict |
| ------------------------------------------------------------------------ | ------- |
| .env ignored and untracked                                               | PASS    |
| Passwords stored only as Argon2id hashes (user_credentials)              | PASS    |
| No credentials in source (scanned at every push)                         | PASS    |
| No real PII in fixtures (example.test / FAKE-* / TEST-ACCEPT-* only)     | PASS    |
| No real workbook committed                                               | PASS    |
| No production DB access (dev-safety guard on scripts; local dev DB only) | PASS    |
| Candidates 2002/2003 untouched (before/after snapshot identical)         | PASS    |

## Import Dry-Run

| Check                                                              | Verdict |
| ------------------------------------------------------------------ | ------- |
| Fictional workbook parses (6 sheets, 12 rows)                      | PASS    |
| Review issues produced (14 issue codes exercised)                  | PASS    |
| No business-table writes (row counts identical; SELECT-only guard) | PASS    |
| Report PII-safe (row numbers + candidate IDs + codes only)         | PASS    |
| Candidates 2002/2003 unchanged by the run                          | PASS    |

(Evidence: CLI run report `validation/import-dry-run/2026-10-14-08-06-fictional-demo.md` + 21 automated tests.)

## Totals

- PASS: 66 checks
- FAIL: 0 — the three initial failures were re-verified as correct application behavior (inclusive 7-day evaluation; extend requires an explicit end date; exit date before join refused) and passed on retest
- BLOCKED: 7 (phone response values; Module 6 questions 1–5 incl. automatic creation; final role list) — all mentor decisions, none invented
- NOT APPLICABLE: 4 feature areas (Dashboard metrics, Reports, Exports, Weekly report — not built yet) + salary (not implemented by rule)

## Cleanup

All TEST-ACCEPT candidates, phone screens, interviews, offers, employee, phase history, notifications, email log rows, email templates and lookup rows were deleted (scoped `LIKE 'TEST-ACCEPT%'` deletes). Verified: business tables back to exactly their pre-test counts; only candidates 2002/2003 remain, timestamps unchanged. Retained by design: the fictional user `viewer@example.test` (deactivated, cannot sign in) and its empty test role, because the append-only audit log correctly refuses to orphan an actor's history — deleting audit rows would be wrong; and the audit entries of the test actions themselves, since the audit log is never deleted.
