# PUSH prompt: commit and push the Dashboard

Paste into Claude Code after reviewing the dashboard locally at http://127.0.0.1:5173/dashboard.

---

Continue the Recruitment Sheet to System project.

Current confirmed state:

- The Dashboard is built locally and I have reviewed it in the browser.
- 681/681 automated tests pass (369 backend + 312 frontend); build, lint, format pass.
- origin/main is at ce312c0 (final dummy-data acceptance).
- The Dashboard work is uncommitted: new backend/src/modules/dashboard/, mounted route, rewritten DashboardPage.jsx, 14 new tests, an updated placeholder test in routes.test.jsx, a test-only race fix in candidates.test.js, documentation/dashboard.md, validation/dashboard-validation.md, and the handover update.
- prompts/ files must remain uncommitted.
- No real data was used; candidates 2002/2003 untouched.

Your task is ONLY:

FINAL REVIEW → COMMIT → PUSH THE DASHBOARD

Do not change application behaviour.
Do not import real data.
Do not force push.

1. Run git status and git diff --stat. Confirm the changes are exactly the Dashboard set above; anything else stays unstaged (especially prompts/).
2. Re-run the full quality gate: npm test, npm run build, npm run lint, npm run format:check — all must pass.
3. Security scan the files being committed (no credentials, no real PII, .env still ignored and untracked).
4. Stage only the Dashboard files (including the two docs and the handover update). Show the staged summary.
5. Commit message: "Add database-backed dashboard"
6. Push normally to origin main.
7. Post-push verify: dashboard files on origin/main; Modules 1-6, migrations, import framework and acceptance docs unchanged; prompts/ not pushed.

Return a result report (review, security, files, commit hash, push, verification, next step) and finish exactly with:
STATUS: DASHBOARD_PUSH_COMPLETE
