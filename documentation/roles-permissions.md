# Roles & Permissions (Stage 11)

The `/admin/roles` page is a **read-only** view of the configured roles and permissions. Stage 11 adds the approved role model and permission assignments in migration 009. Role assignment and permission editing are not part of this page.

## Why read-only

Roles and permissions are configured by migration 009 and enforced by the backend. This page intentionally has no create, edit, delete, or permission-assignment controls; the integration tests verify the read-only API behavior.

## Routes and permission

Both under `/api/admin/roles`, requiring `admin.manage` (401 unauthenticated, 403 without the permission, backend-enforced):

- `GET /` — every role with its assigned permission codes and user count, plus the full permission catalogue (so the page can draw the matrix in one request)
- `GET /:id` — one role; 404 for an unknown or malformed id

## Safe fields only

A role returns exactly: id, code, name, description, assigned permission codes and the number of users holding it. Never user rows, emails, password hashes, session data, tokens or salary values (asserted by test).

## What is in the database today (dev)

- Roles and permissions: see migration 009 and the role matrix rendered by the page. The Main User has administrative access; HR, Team Lead, and Intern / Dev are restricted by their assigned permissions.
- Salary permissions are not used to grant HR, Team Lead, or Intern / Dev access. Salary routes separately enforce Main User access.

## Frontend

`/admin/roles` (RolesPage) shows the roles table (role, code, description, permissions, user count) and a read-only **permission matrix** (rows = permissions, columns = roles, cells = Assigned / –). Loading, forbidden, empty and error states are handled; there are no buttons, checkboxes or inputs in the matrix.
