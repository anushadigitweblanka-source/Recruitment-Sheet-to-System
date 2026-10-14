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
- `work_mode` has no enforced list because its values are not approved yet. `location` is plain text.
- **No salary.** There is no salary column and no `offer_salary` table until the salary design is approved. Email status is not a column; it will be read from the email log.

The open decisions behind these choices are listed in `backend/src/modules/offers/README.md`.

Tables for employees and notifications do not exist yet. Their design is in `docs/database-schema-proposal.md` and is waiting for the decisions listed in `docs/mentor-approval-required.md`.

The application connects through `backend/src/db/pool.js` using the `DB_*` variables in `.env`.
