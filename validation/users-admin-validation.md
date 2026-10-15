# Users Administration Validation (2026-10-14)

Live verification against the running development app, fictional account only (`users-test@example.test`, fictional passwords). Candidates 2002/2003 untouched (timestamps verified).

| Check                                   | Expected                                   | Actual                                                                                     | Result |
| --------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------ | ------ |
| GET /api/admin/users without login      | 401                                        | 401                                                                                        | PASS   |
| Role list comes from the database       | existing rows only                         | main_user (+ the leftover deactivated test role)                                           | PASS   |
| Create fictional user                   | 201, no hash/secret in answer              | 201, safe fields only                                                                      | PASS   |
| New user signs in                       | 200                                        | 200                                                                                        | PASS   |
| Deactivate → sign-in refused            | 401 (same as wrong password)               | 401                                                                                        | PASS   |
| Reactivate → sign-in works              | 200                                        | 200                                                                                        | PASS   |
| Reset password → old refused, new works | 401 / 200                                  | 401 / 200                                                                                  | PASS   |
| Audit trail complete                    | create, status changes, reset all recorded | USER_CREATE, USER_DEACTIVATE, USER_REACTIVATE, USER_PASSWORD_RESET (plus the login events) | PASS   |
| Password values in audit rows           | never                                      | none                                                                                       | PASS   |
| Cleanup                                 | fictional user deactivated, not deleted    | DONE                                                                                       | PASS   |

**Why the fictional user remains (deactivated):** its audit rows reference the user id, and the audit log is append-only by design — deleting the user would require deleting history. The account `users-test@example.test` is clearly fictional, deactivated (cannot sign in), and documented here, matching the earlier precedent of `viewer@example.test`.

Automated: 10 backend + 7 frontend tests green — 401/403, safe-fields-only listing, DB-only role list, atomic create with Argon2id hash and no plain password in the database or audit, duplicate email 422, full validation set, deactivate (sessions removed, login refused), self-deactivation blocked, reactivate, reset (old refused/new works, nothing secret audited, short password 422), no DELETE route, plus the UI flows (render, empty, roles dropdown, create + clear password, server validation, confirm-guarded deactivate, mismatch-guarded reset that clears its inputs).

Full suite: **415 backend + 335 frontend = 750 passing**; build/lint/format clean. No migration created.
