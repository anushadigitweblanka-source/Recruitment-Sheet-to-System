# BUILD prompt: Reports module

Paste into Claude Code to build the on-screen Reports module. Exports (Excel/CSV/PDF) and the scheduled weekly email are separate later steps.

---

Continue the Recruitment Sheet to System project.

CURRENT VERIFIED STATE:

- origin/main is at 4428ed7 (database-backed dashboard).
- Modules 1-6, import dry-run framework, data maps, acceptance docs and Dashboard are complete and pushed.
- 681/681 automated tests pass; build/lint/format pass.
- Reports, exports and the weekly report email are NOT STARTED.
- Development must use FICTIONAL / DUMMY DATA ONLY (RPT-TEST-* prefixes, example.test emails).
- Candidates 2002 and 2003 must not be modified.

Your task is ONLY:

BUILD THE ON-SCREEN REPORTS MODULE

Do NOT build Excel/CSV/PDF exports yet.
Do NOT build the weekly email sending (recipients are a mentor decision) — only the on-screen weekly figures.
Do NOT import real data. Do NOT implement salary. Do NOT commit or push until I review.

1. INSPECT FIRST: current dashboard module (reuse its query patterns), task-guide requirements recorded in docs/database-schema-proposal.md, frontend page/navigation conventions, test conventions. Report what you will create before coding.

2. Implement, as far as the current schema supports, read-only report endpoints under /api/reports (candidates.view permission, backend-enforced):
   - Candidate status report: candidates with current stage, filterable by stage, position, source, date range.
   - Funnel report: counts per pipeline stage in order, over a date range (stage_history based for movement, pipeline_status for current).
   - Source report and Position report: candidates per source / per position with outcome breakdown.
   - Weekly recruitment figures: applications and stage movements for the previous Monday-Sunday week, Asia/Colombo. On-screen only; no email, no scheduler.
   - Onboarding report: employees by join date range with phase/status.
   - Exit report: discontinued and terminated employees with dates and reasons.
     Document the query basis of every figure. Do not invent fields the guide does not confirm (no team lead, no salary).

3. Frontend: a Reports section following the existing layout with one page per report (or tabs), filters, loading/empty/error states, dates in Asia/Colombo. No hardcoded numbers.

4. Tests: backend tests per report (401/403, correctness on fictional fixtures, filters, week-boundary logic) and frontend tests (render, filters, states), following current conventions.

5. Verification: live API check against the dev server with RPT-TEST-* fictional data, validated against direct DB counts, then clean up ONLY that data. Candidates 2002/2003 untouched.

6. Quality gate: npm test, npm run build, npm run lint, npm run format:check - everything green and stable.

7. Docs: documentation/reports.md, validation/reports-validation.md, update handover/current-handover.md. Note the mentor-blocked parts (weekly recipients, Monday 08:00 send).

8. No migrations unless objectively necessary (stop and explain first). Do not commit. Do not push. Run git status at the end.

Return a RESULT report (inspection, endpoints, per-report query basis, frontend, tests, quality, test data + cleanup, security, docs, git) and finish exactly with:
STATUS: REPORTS_READY_FOR_REVIEW
