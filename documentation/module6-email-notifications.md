# Module 6 — Email Notifications (summary, 2026-10-14)

> Historical snapshot from before Stage 11. Automatic reminder creation, mail types and modes, one-off mail actions, offer-mail approval, and weekly reporting have since been implemented. Use `validation/stage11-mentor-blocked-readiness.md` for current status.

Committed and pushed as `a2f5ba5` ("Implement Module 6 email notifications") on `main`, on top of Module 5 (`1da6c23`). Repository: `recruitment-sheet-to-system/` (GitHub: anushadigitweblanka-source/Recruitment-Sheet-to-System).

## What was delivered

- Migration `008_email_notifications.sql`: `notifications` (the schedule), `email_templates` (editable, never deleted; `is_active` switch), `email_log` (every attempt, append-only). No salary, team_leads or company_accounts table.
- Backend module `backend/src/modules/notifications/`: mailService (development adapter only — no real email can be sent), repository, service, validation, routes. Scheduler in `server.js` runs every 15 minutes.
- Confirmed rule implemented exactly: send rows where `send_at <= now AND sent_at IS NULL`; `due_at` is the deadline, `send_at` is 24 hours before.
- Duplicate-send prevention (service check + partial unique index), explicit resend with its own logged row, full audit logging, permission split (view vs `notifications.manage`).
- Frontend pages: Notifications, Email Templates, Email Log, all behind sign-in.
- Tests: 28 backend + 14 frontend notification tests; whole suite 340 + 306 green.

## Decisions taken

- No template content is seeded; wording is the company's to write.
- Automatic notification creation stays OFF until recipient rules are confirmed (no team_leads table, no HR address setting exist).
- Development mail adapter simulates delivery and logs it like a real one; a production adapter will be added behind the same `send()` interface once a provider is approved.

## Open mentor decisions (documented in `backend/src/modules/notifications/README.md`)

1. Recipients per reminder type
2. Retry policy after a failed send
3. Final template-type list
4. `send_mode` behaviour for manual mails
5. `cv_pending` trigger

See [validation record](../validation/2026-10-14-module6-email-notifications.md) and [scheduler workflow](../workflows/module6-notification-scheduler.md).
