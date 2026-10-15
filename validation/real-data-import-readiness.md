# Real Data Import Readiness Checklist (created 2026-10-14)

**Status: NOT READY.** Only the discovery items in the section below are complete. No real recruitment row may be imported until every item is checked, each by the person entitled to check it. Do not mark an item complete without evidence (link it from `evidence/`).

## Discovery progress (2026-10-15) — inspection only, no approvals

- [x] File identified: `Recruitment_Updates_DigitWebLanka (3)(7.csv`, kept outside the repo
- [x] File version/path recorded: 74,234 bytes, SHA-256 prefix `1491c7ff37a3d5e6`
- [x] Structure inspected: 26 columns (8 named, 18 unnamed), Windows-1252, CRLF, 6 multi-line cells
- [x] Row counts known: 1,261 data rows, 404 records, 857 empty rows
- [x] Preliminary mapping prepared: `data-maps/real-csv-to-database.md`, `validation/real-csv-mapping-review.md`
- [ ] Mapping questions answered: `handover/real-csv-mapping-decisions.md` (14 open)

None of these counts as approval for import.

## Authorization

- [ ] Written authorization to load real recruitment data into this system
- [ ] Approved source workbook identified (exact file)
- [ ] Workbook copy/version recorded (filename, date, hash or drive version)
- [ ] HR/mentor sign-off person named

## Source confirmation

- [ ] Source tabs confirmed (names and purpose of every tab)
- [ ] Source columns confirmed (exact headers per tab)
- [ ] Candidate ID format and rule approved (mentor decision 11) — original IDs preserved, none invented
- [ ] Position mapping approved (`data-maps/position-source-mapping.md` filled and signed)
- [ ] Source mapping approved (same file)
- [ ] Status value mapping approved (`data-maps/status-value-mapping.md` — every real spelling listed and APPROVED)
- [ ] Duplicate strategy approved (`duplicate-risk-reports/import-duplicate-rules.md` open questions answered)
- [ ] Date rules approved (`data-maps` §11 behaviour: normalize valid, review invalid, never guess)
- [ ] CV handling approved (reused links flagged; storage decision for uploads is separate)
- [ ] Salary import explicitly DISABLED (no salary design approved) — or explicitly approved with design

## Technical readiness

- [ ] Target mapping reviewed (`data-maps/recruitment-workbook-to-database.md` signed off)
- [ ] Missing schema pieces decided: `is_historical` flag, `applied_on`, `import_batches`/`import_rows` review queue (new migrations, mentor-approved)
- [ ] Importer records every row with its batch (removal-by-import-batch / rollback method ready and tested)
- [ ] Backup of the target database taken immediately before the run
- [ ] Mail sending disabled during import (no notifications created for historical rows; scheduler cannot pick up imported rows)

## Dry run (on a copy, never production)

- [ ] Dry run completed on a disposable database
- [ ] Row counts reconciled (workbook rows = imported + matched + review + skipped + error, per tab)
- [ ] Review queue checked (every needs_review row has a category and is resolvable)
- [ ] Error report checked (no unexplained errors)
- [ ] Duplicate report produced and reviewed (in `duplicate-risk-reports/`)

## Final gate

- [ ] HR/mentor sign-off on the dry-run report
- [ ] Import window agreed (who runs it, when, who reviews)

## Review queue categories (the importer must classify every flagged row as one of)

duplicate candidate · duplicate candidate ID · unknown position · unknown source · invalid phone · invalid email · invalid date · unmatched phone interview · unmatched direct interview · unknown stage/status · invalid score · reused CV link · missing required field · ambiguous candidate match

## Recommended import order (from the actual FK dependencies of migrations 001–008)

1. `positions` (no FKs; referenced by candidates and offers)
2. `sources` (no FKs; referenced by candidates)
3. `candidates` (FK → positions, sources)
4. `pipeline_status` + initial `stage_history` (FK → candidates, pipeline_stages — stages are already seeded, never imported)
5. `phone_screens` (FK → candidates)
6. `interviews` (FK → candidates)
7. `offers` (FK → candidates, positions)
8. `employees` (FK → candidates)
9. `phase_history` (FK → employees)

Module 6 tables (`notifications`, `email_templates`, `email_log`) are NOT part of the recruitment-history import.
