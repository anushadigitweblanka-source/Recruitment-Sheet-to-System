# Settings Admin + Audit Log Viewer Validation (2026-10-14)

Live verification against the running development app, fictional values only; the changed setting was restored to its exact original value; candidates 2002/2003 untouched.

| Check                                                          | Expected                              | Actual                                                                                   | Result |
| -------------------------------------------------------------- | ------------------------------------- | ---------------------------------------------------------------------------------------- | ------ |
| GET /api/admin/settings and /api/admin/audit-log without login | 401 / 401                             | 401 / 401                                                                                | PASS   |
| Settings listed                                                | the 4 seeded keys with values         | evaluation_days=7, junior_months=9, probation_max_extension_months=1, probation_months=3 | PASS   |
| Update evaluation_days to a temporary test value (11)          | 200, value 11                         | 200, 11                                                                                  | PASS   |
| Invalid value (0) refused                                      | 422, unchanged                        | 422                                                                                      | PASS   |
| Restore to original                                            | 200, value 7, exact                   | 200, 7 (exact)                                                                           | PASS   |
| Audit entries for both changes remain                          | 2 SETTING_UPDATE rows with old→new    | 7→11 and 11→7 both present                                                               | PASS   |
| Audit filter entityType=settings + pagination                  | only settings rows, pageSize honoured | PASS, total 2, pageSize 2                                                                | PASS   |
| No password/token/secret/salary keys in viewer output          | never                                 | none                                                                                     | PASS   |
| Candidates table                                               | only 2002/2003, timestamps unchanged  | confirmed                                                                                | PASS   |
| After logout                                                   | 401                                   | 401                                                                                      | PASS   |

Automated: 13 backend (settings 7 + audit 6) + 6 frontend tests green, covering 401/403 on both APIs, exact seeded keys, update + audit record + Module 5 reading the new value, invalid-value rejection (0, −3, 2.5, text, blank, 400), unknown-key 404 (never created), no-op saves writing no audit noise, newest-first pagination, action/entity/actor/date filters, append-only (no write routes), the writer refusing sensitive keys, settings page load/edit/save/validation, audit table render/filters/empty state.

Full suite: **405 backend + 328 frontend = 733 passing**; build/lint/format clean. No migration was created (the existing `settings` and `audit_log` schema and the existing `admin.manage` permission were sufficient).
