# Database

Development database: `recruitment_system_dev` (PostgreSQL 18, local).

## Migrations

Schema changes live in `migrations/`, one numbered SQL file per change. Apply the pending ones from the project root with:

```
npm run db:migrate
```

- Each file runs in its own transaction: it applies completely or not at all.
- The `schema_migrations` table records which files have run.
- A file is never edited after it has been applied. To change something, add a new file.
- The command refuses to run when `NODE_ENV` is `production` or the database name does not end in `_dev`.

| File                           | Creates                                                                                               |
| ------------------------------ | ----------------------------------------------------------------------------------------------------- |
| `001_identity_foundation.sql`  | `roles`, `permissions`, `role_permissions`, `users`, `user_credentials`, `user_sessions`, `audit_log` |
| `002_candidate_management.sql` | `positions`, `sources`, `pipeline_stages`, `candidates`, `pipeline_status`, `stage_history`           |
| `003_phone_screens.sql`        | `phone_screens`                                                                                       |
| `004_interviews.sql`           | `interviews`                                                                                          |
| `005_offers.sql`               | `offers`                                                                                              |
| `006_employee_lifecycle.sql`   | `settings`, `employees`, `phase_history`                                                              |
| `007_offer_work_mode.sql`      | nothing; adds the Work Mode check constraint on `offers`                                              |
| `008_email_notifications.sql`  | `notifications`, `email_templates`, `email_log`                                                       |

`positions` and `sources` start empty; an administrator adds the approved values in the application. `pipeline_stages` holds the twelve stages listed in the task guide.

### `interviews` (migration 004)

Migration 004 creates this one table and three indexes, and nothing else. Stage changes caused by an interview are written to the existing `pipeline_status` and `stage_history` tables.

- Five scores (`score_technical`, `score_ai`, `score_communication`, `score_confidence`, `score_culture_fit`), each checked to be from 0 to 10.
- All five scores are present or none are.
- `total_score` is a generated column, the sum of the five. It cannot be written directly and is empty until all five scores are present.
- `attendance` is `attended`, `not_attended` or empty; `decision` is `selected`, `not_selected`, `on_hold` or empty.
- An interview marked `not_attended` cannot have scores or a decision.
- `interviewer_name` is plain text. `recommendation` has no enforced list because its values are not approved yet.
- `candidate_id` is indexed but not unique, so several interviews per candidate remain possible. The application keeps one for now.

The open decisions behind these choices are listed in `backend/src/modules/interviews/README.md`.

### `offers` (migration 005)

Migration 005 creates this one table and four indexes, and nothing else: no `offer_salary`, `employees`, `phase_history`, `notifications`, `email_templates` or `email_log`. Stage changes caused by an offer are written to the existing `pipeline_status` and `stage_history` tables.

Columns: `id`, `candidate_id`, `position_id`, `offer_date`, `work_mode`, `location`, `offer_status`, `onboarding_date`, `attended`, `created_at`, `updated_at`, `created_by`, `updated_by`.

- `candidate_id` and `position_id` are required foreign keys (to `candidates` and to the approved `positions` list). `candidate_id` is indexed but not unique; the application keeps one offer per candidate for now.
- `offer_status` is `sent`, `accepted` or empty (not sent yet). These two values are a working choice from the guide's stage list, awaiting the mentor's confirmation; adding a value means a new migration.
- `attended` is true, false or empty, and can only be set when `onboarding_date` is filled and `offer_status` is `accepted`.
- `work_mode` is `office` or empty (migration 007). "Office" is a temporary value awaiting mentor confirmation; the confirmed list replaces the constraint in a new migration. `location` is plain text.
- **No salary.** There is no salary column and no `offer_salary` table until the salary design is approved. Email status is not a column; it will be read from the email log.

The open decisions behind these choices are listed in `backend/src/modules/offers/README.md`.

### `employees`, `phase_history` and `settings` (migration 006)

Migration 006 creates these three tables and nothing else: no notification, email, salary or company account table.

- `settings` holds the phase lengths from the task guide as editable values: `evaluation_days` = 7, `probation_months` = 3, `probation_max_extension_months` = 1, `junior_months` = 9 (stored but not used until the junior rule is confirmed).
- `employees`: one row per candidate who joined (unique `candidate_id`), with `join_date`, `track` (`intern`, `staff` or empty), `current_phase`, `phase_start`, `phase_end`, `status` (`active`, `discontinued`, `terminated`) and the exit date, reason and who recorded a termination. Leaving requires a date and a reason; an active employee has neither.
- `phase_history`: one row per phase and per probation extension, with its dates, gate `result` (`pass`, `extend`, `discontinue`), reason, review link, who decided and when. The database allows only one open phase per employee, allows Extend only for probation, gives senior no gate and no end date, and requires a reason to discontinue.

The open decisions behind these choices are listed in `backend/src/modules/employees/README.md`.

### `notifications`, `email_templates` and `email_log` (migration 008)

Migration 008 creates these three tables and nothing else: no salary, team lead or company account table, and no WhatsApp/SMS channel column (out of scope by mentor decision 10).

- `notifications` is the schedule: candidate, type (the six reminder types), the subject link matching the type (phase, interview, offer, or none for a CV chase), `due_at` (the deadline), `send_at` (due minus 24 hours), `sent_at`, recipients, status (`pending`, `sent`, `failed`, `cancelled`), attempts and last error. The database enforces one live reminder of a type per subject, `send_at <= due_at`, and that `sent` and `sent_at` always agree.
- `email_templates`: one editable template per type with subject, body, `send_mode` (`auto`/`review`) and `is_active`. No content is seeded.
- `email_log` is the delivery record: what was actually sent, to whom, with status (`queued`, `sent`, `failed`), error, `is_resend` and who sent it. A partial unique index refuses a second non-resend send of the same template to the same candidate; a failed attempt does not block a retry, and a resend is its own marked row.

The open decisions behind these choices are listed in `backend/src/modules/notifications/README.md`.

The application connects through `backend/src/db/pool.js` using the `DB_*` variables in `.env`.
