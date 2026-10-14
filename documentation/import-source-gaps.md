# Import Source Gaps — what is still missing before real import mapping can be finalized (2026-10-14)

The target side (migrations 001–008) is fully known. The source side is known only through the task guide as recorded in `docs/database-schema-proposal.md`; **the real workbook has never been seen by this project**. Nothing below is guessed — each item must be obtained, not inferred.

## Missing workbook facts

1. **Exact workbook filename and version** (and where the authoritative copy lives).
2. **Exact tab names.** The guide implies Tab 1 (candidates), Tab 2 (phone screening), Tab 3 (direct interviews), Tab 4 (offers), Tabs 5/6 + a Follow_Up tab (status tracking), Tab 7 (interview log without Candidate IDs), Tab 8 (employees) — the real names/spellings are unconfirmed.
3. **Exact column headers per tab.** Field meanings are known (Name, Phone, O/L Maths, A/L Result, A/L Stream, Applied Position, CV Link, Company CV Link/Status, Source, HR Comment, Called, Response, Result, Review, interview date/time, scores, recommendation, decision, offer fields, lifecycle fields) but not the literal headers.
4. **Candidate ID format** of the existing IDs, and the rule for generating new ones (mentor decision 11).
5. **Whether Tab 1 holds an application date** (needed for the weekly applications report and a possible `applied_on` column).
6. **The dropdown value lists**: phone-screen `response`, interview `recommendation`, offer `work_mode` (only `office` is approved so far) — mentor decision 6.
7. **The guide's old-status-word → stage mapping list** (the guide says it gives this mapping; the actual list must be copied into `data-maps/status-value-mapping.md`).
8. **Approved positions list** and the position-name merge table (e.g. the several "Automation" spellings) — mentor decision 6.
9. **Approved sources list** (LinkedIn, ITPro, …) and how "Historical" is represented without overwriting the real source.
10. **Tab 8 review-column layout** (per-phase review info) so `phase_history` rows can be mapped per phase.

## Pending decisions that block parts of the mapping

- **Salary**: no salary may be mapped, imported, or given a column until the design is approved (mentor decisions 1–2).
- **Junior 9 months**: from probation end or from joining (mentor decision 5) — blocks deriving any junior `phase_end`.
- **Discontinued vs Terminated** definitions (mentor decision 4).
- **"Offer Rejected"** — stage or not (mentor decision 3).
- **Duplicate identity rule** — which match means "same person"; returning applicants (proposal §6.2 M).
- **Staff without a candidate record** — do they get a minimal candidate row (mentor decision 11).

## Missing schema pieces (new migrations, only after approval)

- `candidates.is_historical` flag — required before any historical import so old rows never trigger reminders.
- `candidates.applied_on` — if the workbook holds an application date.
- `import_batches` / `import_rows` — the import report and review queue (proposal §14).
- `position_aliases` — the database home of the position merge map.

## Already satisfied (no gap)

- Target table and column names: verified against the live schema.
- Allowed status values: verified against live CHECK constraints (see `data-maps/status-value-mapping.md`).
- Pipeline stage list: 12 stages seeded by migration 002.
- Duplicate logic: implemented and documented (`duplicate-risk-reports/import-duplicate-rules.md`).
- Phase lengths: in `settings` (evaluation 7 days, probation 3 months +1 extension, junior 9 months — end-date rule still pending).
