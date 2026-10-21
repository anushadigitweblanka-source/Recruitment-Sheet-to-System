# CONTINUATION prompt: implement Module 6 mentor decisions

Fill in the five ANSWER lines from the mentor's reply, then paste the whole prompt into Claude Code. Delete any question the mentor has NOT answered yet — unanswered rules must stay unimplemented and documented.

---

Continue the Recruitment Sheet to System application.

Repository root:
C:\AnushaDigitWebLanka\Day02\task 2\Project Instructions Recruitment Sheet to System\recruitment-sheet-to-system

Current confirmed state:

- origin/main has a2f5ba5 (Module 6 email notifications) and cebbb09 (standard documentation folders).
- Migrations 001–008 applied; all tests green (340 backend + 306 frontend).
- Automatic notification creation is OFF, waiting on these mentor answers.

The mentor has now decided (from backend/src/modules/notifications/README.md, "MENTOR CONFIRMATION REQUIRED"):

1. Recipients per reminder type:
   ANSWER: <who receives each of the six types; how team lead and HR addresses are stored>

2. Retry policy for failed sends:
   ANSWER: <retry or not; interval; max attempts>

3. Final template-type list:
   ANSWER: <the confirmed list, or "free slug stays">

4. send_mode behaviour for manual mails:
   ANSWER: <how 'review' mode works, or "defer until manual sending is built">

5. cv_pending trigger:
   ANSWER: <when a CV chase is created and for which candidates, or "out of scope">

Your task:

IMPLEMENT ONLY THE ANSWERED DECISIONS → TEST → COMMIT → PUSH

Rules:

- New tables or columns go in a new migration (009_...); never edit an applied migration.
- Automatic notification creation hooks go where the triggering event happens (phase creation, interview scheduling, offer joining date), using due_at = deadline at 17:30 Asia/Colombo and send_at = due_at − 24 h.
- Keep the development mail adapter; no real provider, no credentials.
- Update the module README: move each implemented decision out of "MENTOR CONFIRMATION REQUIRED" into the documented behaviour, keep unanswered ones listed.
- No salary fields. No real data import. Do not modify candidate records.
- Run npm test, npm run build, npm run lint, npm run format:check before committing.
- Security scan changed files; .env stays ignored and untracked.
- Commit message: "Implement Module 6 mentor-confirmed notification rules". Push normally to origin main; no force push.
- Update validation/, workflows/, documentation/ and handover/ with a dated record of what was implemented.

Return a result report with: git state, migrations, what each answer changed, tests/build/lint/format, security, commit + push, and open items still waiting.

Finish exactly with one:
STATUS: MODULE_6_RULES_IMPLEMENTED_AND_PUSHED
or
STATUS: MODULE_6_RULES_BLOCKED
