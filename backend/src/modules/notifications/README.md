# Module 6 – Email Notifications (backend)

**Implemented:** the notification schedule, editable email templates, the email log, the 15-minute sending job, duplicate-send prevention, explicit resend, and a development mail adapter. **No real email leaves this application:** no mail provider has been approved and no mail credentials exist.

| Route                            | Permission             | Purpose                                     |
| -------------------------------- | ---------------------- | ------------------------------------------- |
| `GET /api/notifications`         | `candidates.view`      | The schedule, with filters and paging       |
| `GET /api/notifications/:id`     | `candidates.view`      | One scheduled reminder                      |
| `POST /api/notifications/run`    | `notifications.manage` | Runs the job now. **Development only**      |
| `GET /api/email-templates`       | `candidates.view`      | All templates (`?active=true/false` filter) |
| `POST /api/email-templates`      | `notifications.manage` | Create a template                           |
| `GET /api/email-templates/:id`   | `candidates.view`      | One template                                |
| `PATCH /api/email-templates/:id` | `notifications.manage` | Change it; only the fields sent are changed |
| `GET /api/email-log`             | `candidates.view`      | Delivery history, with filters and paging   |
| `POST /api/email-log/:id/resend` | `notifications.manage` | Explicit resend of one sent or failed mail  |

Notification filters: `search` (candidate name or ID), `type`, `status`, `sent` (`true`/`false`), `dueFrom`/`dueTo` (office days). Email log filters: `recipient`, `status`, `templateId`, `from`/`to` (office days). Both page with `page`/`pageSize` (at most 100).

Files: `notifications.routes.js` (HTTP), `notifications.service.js` (sending, scheduler, resend, templates), `notifications.validation.js` (field checks), `notifications.repository.js` (SQL), `mailService.js` (the delivery abstraction).

Tables: `notifications`, `email_templates`, `email_log` (migration 008).

## The sending rule (confirmed from the task guide)

- `due_at` is the deadline itself (end date at 17:30 Asia/Colombo). `send_at` is `due_at` minus 24 hours. Both are stored; they are never interchangeable.
- A job runs **every 15 minutes** (`server.js`) and picks rows where **`send_at <= now` AND `sent_at IS NULL`** (and `status = 'pending'`), sends them, and sets `sent_at`. In development the same run can be triggered by hand with `POST /api/notifications/run`.
- A `send_at` already in the past is simply eligible on the next run, which gives the "send immediately" behaviour for very short phases.

## Duplicate prevention (database-enforced)

- One live reminder of a type per subject: partial unique indexes on `(type, phase_history_id)`, `(type, interview_id)`, `(type, offer_id)` and on `candidate_id` for `cv_pending`, each ignoring cancelled rows.
- The job claims each row with `SELECT … FOR UPDATE SKIP LOCKED` and re-checks eligibility inside the transaction, so two overlapping runs can never send the same row.
- "The same template is never sent twice to the same candidate unless HR presses Resend": a partial unique index on `email_log (candidate_id, template_id)` over non-resend queued/sent rows. A failed attempt does not block a retry; a resend is a separate `is_resend = true` row.
- `CHECK ((status = 'sent') = (sent_at IS NOT NULL))` keeps the status and the eligibility rule from ever disagreeing.

## Failure handling

One failing mail marks only its own notification `failed` (with `attempts` and `last_error`) and its log row `failed`, and the run continues. A failed notification is **not retried automatically** (see mentor items); recovery is the explicit Resend. The scheduler never crashes the application: every row runs in its own transaction with its own error handling.

## Mail delivery

`mailService.js` is the only place a provider will ever be configured. Today it returns the **development adapter**: `send()` succeeds without any network call, nothing leaves the machine, and the attempt is still recorded in `email_log` exactly as a real one would be. API answers carry `mailMode: "development"` so the screens can say so. Credentials, when a provider is approved, come from the environment and are never logged.

## Time zones

Timestamps are `timestamptz`, so the database compares real moments regardless of server zone. Day filters sent by the browser are interpreted as **office days (Asia/Colombo)**. The frontend displays every timestamp in Asia/Colombo (`frontend/src/utils/format.js`). The scheduler compares against the database's `now()`, which is zone-safe.

## Audit

`EMAIL_TEMPLATE_CREATE`, `EMAIL_TEMPLATE_UPDATE` (changed fields only), `EMAIL_SEND`, `EMAIL_SEND_FAILED`, `EMAIL_RESEND` (who pressed it and which original row). The audit module refuses passwords, tokens, secrets and salaries at any depth, and no mail credential exists to leak.

## Placeholders

A template subject or body may use `{name}` (candidate full name) and `{candidate_code}`. Nothing else is substituted; salary can never appear because nothing reads it.

## Not part of this module yet

- **No notification is created automatically.** The types, `due_at` = end date at 17:30 and `send_at` = due − 24 h are confirmed, but **who receives each reminder is not** (there is no `team_leads` table and no HR address setting), so no hook writes rows yet. Rows can be created for development tests directly in the database.
- No manual "compose and send" screen, no interview-invitation sending, no WhatsApp/SMS (mentor decision 10: out of scope).

## MENTOR CONFIRMATION REQUIRED

1. **Recipients per reminder type.** The guide says reminders go to "team lead and HR" but defines neither a team-lead record nor an HR address. Until then, automatic creation stays off.
2. **Retry policy.** After a failed send the notification is marked `failed` and not retried automatically. Confirm whether failed sends should retry, how often, and how many times.
3. **Template type list.** Template types are a free slug today (unique, format-checked). Confirm the final list.
4. **`send_mode` for manual mails.** The column exists (`auto`/`review`, default `review`) but only scheduled reminders are sent today, and those follow the 15-minute rule regardless. Confirm how review mode behaves once manual sending exists.
5. **`cv_pending` trigger.** When a CV chase is created, and for which candidates, is not specified.
