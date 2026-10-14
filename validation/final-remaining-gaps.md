# Final Remaining Gaps (2026-10-14)

What stands between the current state and a finished, live system — separated by who owns each item. Based on the final dummy-data acceptance (see final-dummy-acceptance.md).

## A. CODE DEFECTS

None found. 66 acceptance checks passed; the automated suite is 667/667; the three initial acceptance mismatches were test-expectation errors, re-verified as correct application behavior.

## B. MENTOR DECISIONS (block features that are otherwise ready)

1. **Module 6 recipients per reminder type** — blocks automatic notification creation (the sending machinery is done and tested).
2. **Module 6 retry policy** for failed sends.
3. **Module 6 final template-type list** (free slug today).
4. **Module 6 manual send_mode behaviour** (auto/review column exists, manual sending does not).
5. **Module 6 cv_pending trigger** (when, and for which candidates).
6. **Phone-screen `response` value list** (decision 6) — the field currently refuses all values.
7. **Interview `recommendation` value list** and **offer `work_mode` list** (only `office` approved, migration 007 temporary).
8. **Junior 9-month rule** (from probation end or from joining) — junior end date stays uncalculated.
9. **Final role list** (HR / Team lead / Intern; decision 7) — only main_user seeded; permission machinery works.
10. **Salary design** (storage, who may view, access logging) — nothing exists until approved.
11. **"Offer Rejected"** — stage or not (decision 3).
12. **Discontinued vs Terminated definitions** (decision 4) — implemented with the guide's working definition, needs confirmation.
13. **Candidate ID format** and generation rule for new candidates (decision 11).

## C. REAL DATA / GO-LIVE ITEMS

1. Real workbook: filename/version, exact tab names, exact column headers (nothing has been seen).
2. Approved positions + sources lists and the position-name merge mapping → fill `data-maps/position-source-mapping.md`, create rows in Administration.
3. Approved status-word mappings → fill `data-maps/status-value-mapping.md` + `backend/src/import/approvedMappings.js`.
4. New migrations (mentor-approved): `candidates.is_historical`, `candidates.applied_on` (if the workbook has a date), `import_batches`/`import_rows`, `position_aliases`.
5. The real importer itself — a separate reviewed code path (dry-run framework is done; see `workflows/real-data-import.md`).
6. Full readiness gate: `validation/real-data-import-readiness.md` (all 25 items currently unchecked), including backup, rollback-by-batch, mail-off-during-import, HR sign-off.
7. Mail provider approval + production adapter in `mailService.js` (today: development adapter, no delivery).
8. Production environment: database, `NODE_ENV=production` run, real user accounts (no self-registration).

## D. FINAL HANDOVER ITEMS

1. Features not yet built (were always future scope): Dashboard metric queries, Reports module (status/weekly/funnel/source/onboarding/exit), Exports (Excel/CSV/PDF), weekly-report scheduler.
2. Uncommitted local work awaiting the user's review: this acceptance report, final-remaining-gaps.md, the saved Module 6 mentor prompt (`prompts/module6-mentor-decisions-continuation.md`), and the second dry-run demo report if kept.
3. Dev-only artifacts to note at handover: deactivated test user `viewer@example.test` + empty `test_accept_viewer` role (kept because the audit log is append-only); audit entries from acceptance testing.
4. Keep `handover/current-handover.md` updated as the mentor answers land.
