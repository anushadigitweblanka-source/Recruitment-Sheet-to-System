# Workflow — Real Data Import (future; dry-run stage available since 2026-10-14)

The import happens in gates. Today only gates 1–3 are possible; gate 4+ is blocked until the readiness checklist is complete.

1. **Obtain and record the workbook.** Exact filename/version recorded in `validation/real-data-import-readiness.md`; written authorization confirmed.
2. **Confirm the source structure.** Fill the exact tab names and column headers into `data-maps/recruitment-workbook-to-database.md` (replacing each SOURCE COLUMN CONFIRMATION REQUIRED), the status words into `data-maps/status-value-mapping.md`, and the position/source spellings into `data-maps/position-source-mapping.md`. HR/mentor approve the mappings; approved status words are then added to `backend/src/import/approvedMappings.js`, and approved positions/sources are created under Administration → Positions & Sources.
3. **Dry run.** `npm run import:dry-run -- "<workbook>"` — repeat until the report in `validation/import-dry-run/` shows only rows that genuinely need human review. The dry run never writes; it can be run any number of times. Duplicate findings go to `duplicate-risk-reports/` (dated file, candidate codes not names, decisions recorded per pair).
4. **Readiness gate.** Every box in `validation/real-data-import-readiness.md` checked, including: new migrations approved and applied (`is_historical`, import batch/review tables), rollback-by-batch method tested, database backup taken, mail sending confirmed off for historical rows, salary import confirmed disabled.
5. **Real import (not built yet).** A separate, reviewed code path — never a writable switch on the dry run — imports in FK order (positions → sources → candidates → pipeline → phone screens → interviews → offers → employees → phase history), writes every row to the review queue tables, auto-merges nothing, and produces the import report (rows imported / matched / review) for HR sign-off.
6. **Post-import.** Row counts reconciled against the workbook; review queue worked through by HR; batch signed off; raw row data cleared per policy.

Rules that never change: no automatic merge or deletion, no overwrite of existing candidates (2002/2003 included), no invented IDs or dates, no salary, and no reminder emails for historical rows.
