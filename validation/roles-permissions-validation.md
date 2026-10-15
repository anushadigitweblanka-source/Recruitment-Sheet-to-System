# Roles & Permissions View Validation (2026-10-15)

Read-only view only — no database write of any kind. Live checks against the running development app; integration tests against a throwaway schema. Candidates 2002/2003 untouched (no candidate table is involved anywhere in this change).

| Check                                       | Expected                                  | Actual                                                             | Result |
| ------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------ | ------ |
| GET /api/admin/roles without login (live)   | 401                                       | 401                                                                | PASS   |
| POST /api/admin/roles (live, no session)    | rejected (no write route)                 | 401 before routing; with a session the tests prove 404             | PASS   |
| Without admin.manage                        | 403                                       | 403 (integration test)                                             | PASS   |
| Roles returned                              | exactly the DB rows                       | main_user + the test role, codes compared row-for-row against DB   | PASS   |
| Permission codes per role                   | exactly role_permissions                  | compared row-for-row against DB                                    | PASS   |
| Permission catalogue                        | exactly the permissions table             | compared row-for-row against DB                                    | PASS   |
| User counts                                 | match users.role_id                       | compared against DB                                                | PASS   |
| Safe fields only                            | no users/emails/hashes/tokens/salary      | key set asserted; payload scanned                                  | PASS   |
| Write routes (POST/PATCH/PUT/DELETE/assign) | none exist → 404                          | all five attempts 404; roles and role_permissions counts unchanged | PASS   |
| GET /:id                                    | one role / 404 unknown / 404 malformed id | 200 / 404 / 404                                                    | PASS   |
| Read-only notice on the page                | shown                                     | asserted by frontend test                                          | PASS   |
| Matrix is not editable                      | no buttons/checkboxes                     | asserted by frontend test                                          | PASS   |

**Database state shown (dev):** roles `main_user` (all 9 permissions, 3 users) and `test_accept_viewer` (`candidates.view`, 1 user — the leftover deactivated acceptance-test account documented earlier). Permissions: the 9 seeded in migration 001. Nothing was seeded, edited or deleted; **no migration was created**; `role_permissions` untouched.

**Mentor decision still open:** the final role list (HR, Team Lead, Intern) and the editable permission structure. Editing/seeding stays blocked until then.

Automated: 8 backend + 6 frontend tests green — 401/403 on both routes, exact-DB roles and permissions, user counts, safe-fields key set, no write routes (404 ×5, DB counts unchanged), single role + 404s, page render with exact roles, read-only notice, matrix assigned/unassigned cells with no controls, loading, empty, error with retry.

Full suite: **423 backend + 341 frontend = 764 passing**; build/lint/format clean.
