# Current Handover (2026-10-14, after the Reports build)

## State

- origin/main: `4428ed7` (database-backed dashboard) on top of `ce312c0` (acceptance), `f05c5ae` (data maps), `10377c0` (import dry-run framework), `cebbb09`, `a2f5ba5` (Module 6).
- **Uncommitted, awaiting the user's review before any commit:** the Reports module (backend/src/modules/reports/, mounted route, frontend/src/modules/reports/ page + api, navigation entry replacing the placeholder, 11 backend + 5 frontend tests), its docs (documentation/reports.md, validation/reports-validation.md), this handover update, and the local-only prompts.
- Modules: Authentication + 1–6 complete (Module 6 still has 5 open mentor decisions; automatic notification creation OFF). Dashboard and Reports now live from the database (/api/dashboard/summary and /api/reports/*, candidates.view). Exports and the scheduled weekly email are still not started (weekly figures are on-screen only).
- Test suite: 380 backend + 317 frontend = 697 green; build/lint/format clean.
- Database: dev only, migrations 001–008. Local candidates `2002` and `2003` are pre-existing records that must not be modified — verified untouched.
- No real recruitment data imported; no mail provider; no salary anywhere.

## What the dry-run framework does

`npm run import:dry-run -- "<workbook.xlsx>"` validates a workbook end to end and writes a PII-safe report to `validation/import-dry-run/` — with a hard read-only guard (SELECT-only; any write attempt throws). See `documentation/import-dry-run.md` and `workflows/real-data-import.md`.

## How to verify

`npm test` (backend 361 incl. 21 import tests + frontend 306), `npm run build`, `npm run lint`, `npm run format:check` — all green at handover time.

## Blocked / waiting

- Module 6 mentor decisions (recipients, retry, template list, send_mode, cv_pending) — prompt ready in `prompts/module6-mentor-decisions-continuation.md`.
- Real import: blocked on `validation/real-data-import-readiness.md` (all unchecked) and `documentation/import-source-gaps.md` (workbook never seen: tabs, headers, ID format, dropdown lists, approved positions/sources all unconfirmed).
- Missing migrations for a real import (`is_historical`, `applied_on`, import batch/review tables, `position_aliases`) — need mentor approval first.

## Exact next steps

1. User reviews the dry-run framework, then commit + push it.
2. Obtain the real workbook (or its structure) and fill the data maps; get mentor answers on the open decisions.
3. Only after the readiness checklist is fully checked: build the real importer as a separate reviewed path.
