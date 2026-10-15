# Roles & Permissions — read-only view (built 2026-10-15, uncommitted pending review)

The `/admin/roles` placeholder — the last placeholder page — is now a real **read-only** view on the existing identity schema (`roles`, `permissions`, `role_permissions`), unchanged. No migration was created; no role or permission was seeded or modified.

## Why read-only

The final role list (HR, Team Lead, Intern) and the editable permission structure are **still a mentor decision**. Until that is approved, this page only shows what exists in the database. There is deliberately **no** create, edit, delete or permission-assignment route — the integration tests assert those routes do not exist and that `roles` / `role_permissions` stay unchanged.

## Routes and permission

Both under `/api/admin/roles`, requiring `admin.manage` (401 unauthenticated, 403 without the permission, backend-enforced):

- `GET /` — every role with its assigned permission codes and user count, plus the full permission catalogue (so the page can draw the matrix in one request)
- `GET /:id` — one role; 404 for an unknown or malformed id

## Safe fields only

A role returns exactly: id, code, name, description, assigned permission codes and the number of users holding it. Never user rows, emails, password hashes, session data, tokens or salary values (asserted by test).

## What is in the database today (dev)

- Roles: `main_user` (Main User — all 9 permissions) and `test_accept_viewer` (leftover acceptance-test role, `candidates.view` only; kept because the append-only audit log references its user)
- Permissions (9): `candidates.view`, `candidates.edit`, `interviews.manage`, `offers.manage`, `employees.manage`, `notifications.manage`, `admin.manage`, `salary.view`, `salary.edit` — the salary permissions exist in the schema but nothing uses them (salary remains blocked)

## Frontend

`/admin/roles` (RolesPage) shows the roles table (role, code, description, permissions, user count) and a read-only **permission matrix** (rows = permissions, columns = roles, cells = Assigned / –). The page carries the notice: _"Role definitions are read-only until the final role and permission structure is approved."_ Loading, forbidden, empty and error states are handled; there are no buttons, checkboxes or inputs in the matrix.
