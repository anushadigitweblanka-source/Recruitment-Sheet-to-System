# PUSH prompt: commit and push Settings admin + Audit Log viewer

Paste into Claude Code after reviewing /admin/settings and /admin/audit-log in the browser.

---

Continue the Recruitment Sheet to System project.

Current confirmed state:

- origin/main is at cec7d82 (report exports).
- Settings admin + Audit Log viewer are built locally and I have reviewed both pages.
- 733/733 automated tests pass; build, lint, format pass.
- No migration was created; the existing settings/audit_log schema and admin.manage permission were reused.
- Candidates 2002/2003 untouched; the test-edited setting was restored exactly.
- prompts/ files must remain local and uncommitted.

Your task is ONLY:

FINAL REVIEW → COMMIT → PUSH SETTINGS + AUDIT LOG

Do not force push. Do not import real data. Do not touch mentor-blocked features.

1. git status + git diff --stat — confirm the change set is exactly: backend/src/modules/settings/, backend/src/modules/audit/audit.routes.js, route mounts, frontend api/admin.js + SettingsPage.jsx + AuditLogPage.jsx + navigation swap, backend tests (settings.test.js, auditLog.test.js), frontend test (adminSettingsAudit.test.jsx), the three docs and the handover update. Nothing else; prompts/ stays unstaged.
2. Re-run the full quality gate: npm test, npm run build, npm run lint, npm run format:check.
3. Security scan the commit set (no credentials, no real PII, .env ignored/untracked).
4. Stage only those files; show git diff --cached --stat.
5. Commit message: "Add settings admin and audit log viewer"
6. git push origin main (no force).
7. Post-push verify: both features on origin/main; Exports/Reports/Dashboard/Modules 1-6/migrations/import framework unchanged; .env and prompts absent from the remote.

Return a result report (review, security, quality, files, commit, push, verification, next step) and finish exactly with:
STATUS: SETTINGS_AUDIT_PUSH_COMPLETE
