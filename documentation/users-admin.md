# Users Administration (built 2026-10-14, uncommitted pending review)

The `/admin/users` placeholder is now a real page on the **existing identity schema unchanged** — `users` (with `is_active`), `user_credentials` (Argon2id-only check constraint) and the seeded `roles`. No migration was created.

## Routes and permission

All under `/api/admin/users`, requiring `admin.manage` (401 unauthenticated, 403 without it, backend-enforced):

- `GET /` — list users · `GET /roles` — the assignable roles (exactly the rows in the database)
- `POST /` — create a user · `PATCH /:id/status` — deactivate/reactivate · `POST /:id/reset-password`
- **No DELETE route exists**: the audit log references users, so leaving is deactivation, never deletion.

## Safe fields only

The list returns id, name, email, active status, role, last sign-in and created date — never password hashes, session tokens, failed-attempt counters or lock times (asserted by test).

## Create flow

Validates name (≤150), email (shape, normalized to lower case, unique — 422 on duplicate), an **existing** role id, and a password of 12–200 characters (the same `hashPassword` rule as sign-in). User + credential are inserted **atomically** in one transaction with a `USER_CREATE` audit entry (email/name/role only — never the password). The plain password is hashed with the existing Argon2id helper and is never stored, logged or echoed back.

## Deactivate / reactivate

Status change is audited (`USER_DEACTIVATE` / `USER_REACTIVATE` with old/new). Deactivation **deletes the user's sessions in the same transaction**, so they are signed out everywhere at once, and sign-in is refused — with the same 401 as a wrong password, so the answer reveals nothing about the account. An administrator cannot deactivate their own account (422).

## Reset password

Replaces the hash (Argon2id), resets the failed-attempt counter and lock, **deletes the user's sessions**, and writes `USER_PASSWORD_RESET` with no password value. Verified live and by test: the old password gets 401, the new one signs in.

## Session behaviour

Sessions live in `user_sessions` (token hashes only); both deactivation and password reset remove the target user's rows, which is this architecture's safe way to end their signed-in browsers immediately.

## Frontend

`frontend/src/pages/UsersPage.jsx`: user table (Name, Email, Role, Status badge, Last sign-in, Actions), Create User form (masked password, cleared from state immediately after save, server validation shown per field), confirm dialog before deactivate/reactivate, Reset-password form (new + confirm, masked, cleared after submit, never shows any existing value). States: loading, forbidden, empty, error-with-retry, success notices.

## Current role limitation

Only the roles present in the database are offered — today `main_user` (plus any local test role). The final role list (HR, Team Lead, Intern) is mentor decision 7; **no role is invented or seeded here**, and the page says so in an info notice.
