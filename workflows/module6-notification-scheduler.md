# Workflow — Module 6 notification scheduling (as implemented, 2026-10-14)

How a scheduled reminder flows through the system. Source of truth: `recruitment-sheet-to-system/backend/src/modules/notifications/` and migration `database/migrations/008_email_notifications.sql`.

1. A notification row holds `due_at` (the deadline, end date at 17:30 Asia/Colombo) and `send_at` (due_at minus 24 hours). **Automatic creation is OFF** until the mentor confirms recipients; rows are created manually in the dev database for testing.
2. Every 15 minutes the backend job (`server.js`) runs. A re-entry guard stops overlapping runs in one process.
3. The job selects rows where `status = 'pending' AND sent_at IS NULL AND send_at <= now()`, oldest first.
4. Each row is claimed in its own transaction with `FOR UPDATE SKIP LOCKED`, so two runs or two servers never send the same row.
5. The active template for the notification type is loaded; `{name}` and `{candidate_code}` placeholders are filled.
6. Duplicate guard: if this template was already sent (non-resend, queued/sent) to this candidate, the send is refused and recorded as failed. A partial unique index backs this against races.
7. An `email_log` row is written first (`queued`), then the mail service is called. The only adapter is the development one: it delivers nothing and succeeds; `mailMode: "development"` is shown in the UI.
8. On success the log row becomes `sent` and the notification `sent` with `sent_at`; on failure both are marked `failed` with the error. Every outcome is audited (EMAIL_SEND / EMAIL_SEND_FAILED).
9. Resend is an explicit user action (`notifications.manage` permission): a new `email_log` row with `is_resend = true` and an EMAIL_RESEND audit entry; the original row is untouched.
10. In development the job can be triggered by hand via `POST /api/notifications/run`; this is refused in production.
