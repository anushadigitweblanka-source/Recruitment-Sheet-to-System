# Import Dry-Run Framework (2026-10-14)

A workbook can now be validated end to end **without writing any recruitment data**. The framework reads an .xlsx file, checks its structure and every row against the data maps and the existing database (read-only), and writes a PII-safe report. There is no other mode: a real import is a separate, future, mentor-approved step.

## How to run

```
npm run import:dry-run -- "C:\path\Recruitment.xlsx"
```

Prints the detected sheets, row counts, review counts and the report path. The report lands in `validation/import-dry-run/`.

## The hard safety rule

Every database handle the dry run uses is wrapped by `backend/src/import/readOnlyDb.js`, which refuses anything that is not a single plain `SELECT` (no second statement behind a semicolon, no data-modifying CTE). An attempted write throws `DryRunWriteError` before any SQL reaches the database. Tests prove business-table row counts are identical before and after a full run.

## Files

| File                                         | Does                                                                                                                                                                                                                                                       |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `backend/src/import/readOnlyDb.js`           | the read-only guard (`mode: 'dry-run'`)                                                                                                                                                                                                                    |
| `backend/src/import/workbook.js`             | reads sheets, headers, rows (ExcelJS); reports duplicate/blank headers                                                                                                                                                                                     |
| `backend/src/import/expectedStructure.js`    | the expected areas and provisional header aliases from the data map; sheets are recognized by headers, never by name; salary-like headers are flagged                                                                                                      |
| `backend/src/import/normalize.js`            | phone (text only; numeric cells → review), email, date (ISO or true date cells; ambiguous → review), datetime (explicit timezone), scores (0–10, all-five-or-none, source total compare-only), candidate ID (preserved, never invented), booleans, lookups |
| `backend/src/import/approvedMappings.js`     | approved status-word mappings — all empty until approved in `data-maps/status-value-mapping.md`                                                                                                                                                            |
| `backend/src/import/matchCandidates.js`      | candidate matching: ID → phone (last 9 digits) → email → name+position; ambiguous → review, never auto-attached                                                                                                                                            |
| `backend/src/import/validateRows.js`         | per-tab validators → READY / REVIEW_REQUIRED / SKIPPED with issue codes                                                                                                                                                                                    |
| `backend/src/import/dryRun.js`               | orchestrator + summary                                                                                                                                                                                                                                     |
| `backend/src/import/report.js`               | PII-safe Markdown report (tab, row number, candidate ID, issue code, explanation — never phone/email/name values)                                                                                                                                          |
| `backend/scripts/import-dry-run.js`          | the CLI (refuses non-development databases via `devSafety.js`)                                                                                                                                                                                             |
| `backend/tests/importDryRun.test.js`         | 21 tests incl. the no-write guarantee                                                                                                                                                                                                                      |
| `backend/tests/helpers/fictionalWorkbook.js` | fictional fixture builder (example.test emails, fake names/phones, dummy positions; never candidates 2002/2003)                                                                                                                                            |

## Issue codes

`duplicate_candidate`, `duplicate_candidate_id`, `unknown_position`, `unknown_source`, `invalid_phone`, `invalid_email`, `invalid_date`, `unmatched_phone_interview`, `unmatched_direct_interview`, `unmatched_candidate`, `unknown_status`, `invalid_score`, `reused_cv_link`, `missing_required_field`, `ambiguous_candidate_match`, `unknown_header`, `unknown_sheet`, `salary_column_present`, `invalid_text`.

## Current behaviour to expect

With no approved status mappings and empty position/source lists, nearly every row of a real workbook will be REVIEW_REQUIRED — that is correct: nothing is silently normalized. The row to READY path opens as approvals land in `data-maps/status-value-mapping.md` + `approvedMappings.js` and in Administration → Positions & Sources.

Dependency added: `exceljs` (backend). See `workflows/real-data-import.md` for the end-to-end process and `validation/real-data-import-readiness.md` for the gate checklist.
