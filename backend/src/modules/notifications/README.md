# Module 6 – Email Notifications (backend)

**Not implemented.** No routes, queries, tables or mail connection exist. This application sends no emails.

Will cover: scheduled reminders, email templates and the email log.

Planned tables: `notifications`, `email_templates`, `email_log`.

Confirmed sending rule (from the task guide): a reminder is eligible when `send_at <= current time AND sent_at IS NULL`. `due_at` is the deadline; `send_at` is 24 hours before it.

The same template is never sent twice to the same candidate unless it is explicitly resent.
