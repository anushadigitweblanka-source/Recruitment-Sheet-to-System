# Audit Log Viewer (built 2026-10-14, uncommitted pending review)

The `/admin/audit-log` placeholder is now a real, **read-only** viewer over the `audit_log` table that every module has been writing to since migration 001. The log stays append-only: the API has exactly one GET route; POST/PATCH/PUT/DELETE do not exist (tested), and nothing in the application ever updates or deletes an audit row.

## API and permission

`GET /api/admin/audit-log` — requires `admin.manage` (reused, no new permission): 401 unauthenticated, 403 without it.

Filters (all optional, validated against the actual schema): `action` (upper-case code, e.g. SETTING_UPDATE), `entityType` (e.g. candidates, settings), `actorUserId`, `from`/`to` (calendar days in Asia/Colombo on `occurred_at`). Pagination: `page`, `pageSize` (max 100, default 25), newest first.

## What is shown

Date/time (Asia/Colombo), actor (full name, or "System" for entries with no actor such as scheduler sends), action code, entity (`type #id`), and a compact summary built from the stored `details` and `old_values → new_values`.

## Sensitive-field exclusions

The payloads are safe to display **by construction**: `recordAudit` refuses any key matching password/hash/token/secret/salary at any depth before a row is ever written (`backend/src/modules/audit/audit.js`), and a test on the viewer proves no such key appears in its output. The viewer adds no raw request data of its own.

## Frontend

`frontend/src/pages/AuditLogPage.jsx`: filter bar (action, entity type, date range), paged table, loading / forbidden / empty / error states.
