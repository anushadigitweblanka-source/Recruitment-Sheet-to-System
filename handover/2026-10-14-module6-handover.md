# Handover — after Module 6 (2026-10-14)

## Current state

- Application root: the repository root (`recruitment-sheet-to-system/`). Application code lives in `backend/`, `frontend/`, `database/`, `docs/`; the standard task folders (evidence/, documentation/, handover/, closure/, validation/, workflows/, sql/, capability/, prompts/, data-maps/, query-packs/, duplicate-risk-reports/) sit alongside them in the repository root and hold task-level documentation only.
- Branch `main`, clean working tree, local = origin.
- Latest commit: `a2f5ba5` "Implement Module 6 email notifications" (pushed).
- Modules complete: Authentication, 1 Candidate Management, 2 Phone Interview, 3 Direct Interview, 4 Offer Management, 5 Employee Lifecycle, 6 Email Notifications (as far as rules are confirmed).
- Dev database `recruitment_system_dev`: migrations 001–008 applied.
- No real email can be sent (development mail adapter only; no SMTP dependency or credentials anywhere). No real recruitment data imported.

## How to run

- `npm run dev` from the app root → frontend http://127.0.0.1:5173, backend health http://127.0.0.1:3000/api/health.
- Credentials are configured in the app root `.env` (git-ignored, never committed). Dev sign-in account comes from the `DEV_ADMIN_*` variables + `npm run db:create-dev-admin`.
- Quality: `npm test`, `npm run build`, `npm run lint`, `npm run format:check` — all green at handover.

## Blocked / waiting on mentor

- Module 6 automatic notification creation is OFF until recipient rules are confirmed. The five open questions are listed under "MENTOR CONFIRMATION REQUIRED" in `recruitment-sheet-to-system/backend/src/modules/notifications/README.md` (recipients, retry policy, template-type list, manual send_mode, cv_pending trigger). Earlier modules have their own such sections in their module READMEs.
- Salary design not approved: no salary field or table anywhere.
- Junior end date: 9-month rule unconfirmed, not calculated.
- Mail provider not approved: do not add SMTP/API credentials.

## Exact next steps

1. Collect mentor answers to the Module 6 open questions, then implement automatic notification creation (the hooks) per the answers.
2. Reports module (Module 7?) — **not started**, by instruction.
3. Real data import — needs approval first; prepare mappings in `../data-maps/` beforehand.
