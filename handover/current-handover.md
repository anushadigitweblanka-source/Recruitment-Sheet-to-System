# Current Handover (2026-10-14, after the Settings + Audit Log build)

## State

- origin/main: `cec7d82` (report exports) on top of `97a56ae` (reports), `4428ed7` (dashboard), `ce312c0` (acceptance), `f05c5ae` (data maps), `10377c0` (import dry-run framework), `cebbb09`, `a2f5ba5` (Module 6).
- **Uncommitted, awaiting the user's review before any commit:** the Settings admin + Audit Log viewer (backend/src/modules/settings/, backend/src/modules/audit/audit.routes.js, mounts, SettingsPage + AuditLogPage replacing two placeholders, api/admin.js, 13 backend + 6 frontend tests), their docs (documentation/admin-settings.md, documentation/audit-log.md, validation/admin-settings-audit-validation.md), this handover update, and the local-only prompts. Exports are pushed at cec7d82.
- Modules: Authentication + 1–6 complete (Module 6 still has 5 open mentor decisions; automatic notification creation OFF). Dashboard and Reports now live from the database (/api/dashboard/summary and /api/reports/*, candidates.view). Excel/CSV/PDF exports are built for every report. Settings admin (/admin/settings) and the Audit Log viewer (/admin/audit-log) are now real pages (admin.manage). Remaining placeholders: Users and Roles & Permissions. The scheduled weekly email remains not started (mentor-blocked recipients).
- Test suite: 405 backend + 328 frontend = 733 green; build/lint/format clean.
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
