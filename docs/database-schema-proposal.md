# Database Schema Proposal

**Status: proposal for review. Nothing in this document has been created in any database.**

Source of requirements: _Recruitment Sheet to System – Intern Task Guide_ (the "guide").
Target: PostgreSQL 18, development database `recruitment_system_dev`.

Every item is labelled with where it comes from:

| Label | Meaning                                                                          |
| ----- | -------------------------------------------------------------------------------- |
| **C** | Confirmed requirement: stated in the guide                                       |
| **P** | Proposed design: not in the guide, suggested to make the requirement work        |
| **M** | Mentor confirmation required: the guide is silent, unclear or contradicts itself |

The recruitment workbook has not been seen while writing this. Anything that depends on its actual values (the format of the existing Candidate ID, the dropdown values in each tab) is marked **M**.

---

## 1. Conventions (all P)

- **Primary keys:** every table has `id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY`, unless stated otherwise.
- **Foreign keys:** named `<thing>_id`. All use `ON DELETE RESTRICT` unless stated otherwise, so a row that other rows depend on cannot be deleted by accident.
- **No hard deletes of business records.** Candidates, interviews, offers, employees and history rows are never deleted by the application. Lookup rows are switched off with `is_active = false`.
- **Dates and times:** `date` for calendar dates, `timestamptz` for moments in time. The application works in `Asia/Colombo` (C: guide section 4).
- **Row stamps:** business tables carry `created_at timestamptz NOT NULL DEFAULT now()`, `updated_at timestamptz NOT NULL DEFAULT now()`, `created_by bigint REFERENCES users`, `updated_by bigint REFERENCES users`. These four columns are not repeated in the tables below; they are listed as "row stamps".
- **Text, not `varchar(n)`:** PostgreSQL treats them the same; length limits are added as `CHECK` constraints only where a limit matters.

## 2. Controlled values: enums, lookup tables or validated text

The guide requires dropdowns for all closed lists: stage, position, source, decision (C: section 8).

| Kind of list                                                                          | Recommendation                     | Why                                                                                                                                                |
| ------------------------------------------------------------------------------------- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Company data that HR changes over time: **position**, **source**                      | **Lookup tables**                  | HR can add or retire a value without a developer. Old records keep pointing at the retired value. Needed anyway for the position-name merge table. |
| Workflow values the code depends on: **stage**, **decision**, **phase**, **statuses** | **Text with a `CHECK` constraint** | Each value has program logic attached, so adding one always needs a code change. A `CHECK` is easy to read and easy to change in a migration.      |
| PostgreSQL `ENUM` types                                                               | **Not recommended**                | Values cannot be removed and are awkward to rename, which is a poor fit while the lists are still being agreed.                                    |

No position or source values are listed in this document. They must come from HR (**M**).

---

## 3. Relationship diagram

```
                         positions ──< position_aliases
                             │
              sources        │        team_leads >── positions
                 │           │
                 ▼           ▼
            ┌──────────────────────────┐
            │        candidates        │ 1 ── 1  pipeline_status   (current stage)
            └──────────────────────────┘ 1 ── <  stage_history     (every stage change)
              │      │       │      │    1 ── <  candidate_files   (CV metadata)
              │      │       │      │    1 ── <  candidate_upload_links
              │      │       │      │
              ▼      │       │      │
        phone_screens│       │      │
           (1 ── 1)  ▼       │      │
                 interviews  │      │
                  (1 ── <)   ▼      │
                     │     offers ──── 1 ── 0..1  offer_salary ── < salary_access_log
                     │     (1 ── <)
                     └──────►│
                             ▼
                         employees  (1 ── 0..1 per candidate)
                             │  1 ── <  phase_history
                             │  1 ── 0..1  company_accounts
                             ▼
                       phase_history ── < notifications ── < email_log
                                                              ▲
                                             email_templates ─┘

  users >── roles ──< role_permissions >── permissions
  users are referenced by: row stamps, stage_history, phase_history,
                           audit_log, salary_access_log, email_log

  audit_log        records changes to any table (entity_type + entity_id)
  settings         phase durations, deadline time, time zone
  import_batches ──< import_rows   (one-time workbook import, with review list)
```

Main path: **Candidate → Phone Screen → Interview → Offer → Employee → Phase History.**

---

## 4. Users, roles and permissions

The guide defines four roles (C: section 7, second part): **Main user** (everything including salary), **HR** (no salary), **Team lead** (own team only, no salary), **Intern/dev** (test data only).

- **M:** the guide also mentions a "manager" and "IT" as people who receive mails or act on accounts, without defining them as roles. Is a manager the same as a team lead? Does IT need a login?
- **M:** login method. The design below assumes email plus password. If the company wants Google sign-in instead, `password_hash` is dropped.

### 4.1 `roles` (P)

Purpose: the list of roles a user can hold.

| Column        | Type   | Null | Default  | Rule                     |
| ------------- | ------ | ---- | -------- | ------------------------ |
| `id`          | bigint | no   | identity | PK                       |
| `code`        | text   | no   |          | UNIQUE; lower_snake_case |
| `name`        | text   | no   |          | display name             |
| `description` | text   | yes  |          |                          |

- Deletion: never; a role in use cannot be deleted (RESTRICT).
- Audit: changes written to `audit_log`.

### 4.2 `permissions` (P)

Purpose: the list of things the backend can allow or refuse, for example `candidates.edit`, `salary.view`, `users.manage`.

| Column        | Type   | Null | Default  | Rule   |
| ------------- | ------ | ---- | -------- | ------ |
| `id`          | bigint | no   | identity | PK     |
| `code`        | text   | no   |          | UNIQUE |
| `description` | text   | yes  |          |        |

### 4.3 `role_permissions` (P)

Purpose: which role has which permission.

| Column          | Type   | Null | Rule                                  |
| --------------- | ------ | ---- | ------------------------------------- |
| `role_id`       | bigint | no   | FK → `roles`, ON DELETE CASCADE       |
| `permission_id` | bigint | no   | FK → `permissions`, ON DELETE CASCADE |

- Primary key: (`role_id`, `permission_id`).
- Salary is covered by its own permissions (`salary.view`, `salary.edit`), granted only to the Main user role (C). The backend checks the permission on every request; the frontend hiding a field is never the control.
- **M:** the final grid of which role gets which permission.

### 4.4 `users` (P)

Purpose: people who can sign in.

| Column          | Type        | Null | Default  | Rule                                                  |
| --------------- | ----------- | ---- | -------- | ----------------------------------------------------- |
| `id`            | bigint      | no   | identity | PK                                                    |
| `full_name`     | text        | no   |          |                                                       |
| `email`         | text        | no   |          | UNIQUE on `lower(email)`                              |
| `password_hash` | text        | no   |          | a one-way hash (argon2id or bcrypt); never plain text |
| `role_id`       | bigint      | no   |          | FK → `roles`                                          |
| `is_active`     | boolean     | no   | `true`   | switched off instead of deleting                      |
| `last_login_at` | timestamptz | yes  |          |                                                       |
| row stamps      |             |      |          |                                                       |

- One role per user (P). This is the simplest model that satisfies the guide's role table. A `user_roles` link table can replace `role_id` later if one person ever needs two roles.
- Indexes: unique `lower(email)`; `role_id`.
- Deletion: never; deactivate.
- Audit: creation, role change, deactivation and password change (the fact, not the value) go to `audit_log`.

---

## 5. Lookups and settings

### 5.1 `positions` (C: closed list; P: table shape)

| Column      | Type    | Null | Default  | Rule                    |
| ----------- | ------- | ---- | -------- | ----------------------- |
| `id`        | bigint  | no   | identity | PK                      |
| `name`      | text    | no   |          | UNIQUE on `lower(name)` |
| `is_active` | boolean | no   | `true`   |                         |
| row stamps  |         |      |          |                         |

- **M:** the approved list of position names.

### 5.2 `position_aliases` (C: "mapped by a table HR approves", section 10)

Purpose: maps every spelling found in the workbook to one approved position, so the import can merge names such as the three "Automation" variants.

| Column        | Type        | Null | Rule                     |
| ------------- | ----------- | ---- | ------------------------ |
| `id`          | bigint      | no   | PK                       |
| `alias`       | text        | no   | UNIQUE on `lower(alias)` |
| `position_id` | bigint      | no   | FK → `positions`         |
| `approved_by` | bigint      | yes  | FK → `users`             |
| `approved_at` | timestamptz | yes  |                          |

### 5.3 `sources` (C: closed list; P: table shape)

Same shape as `positions`: `id`, `name` (unique, case-insensitive), `is_active`, row stamps.

- **M:** the approved list of sources.

### 5.4 `team_leads` (C: section 5 and 8)

Purpose: who leads the team for a position. The system picks the team lead from the applied position.

| Column        | Type    | Null | Default  | Rule                                        |
| ------------- | ------- | ---- | -------- | ------------------------------------------- |
| `id`          | bigint  | no   | identity | PK                                          |
| `position_id` | bigint  | no   |          | FK → `positions`                            |
| `lead_name`   | text    | no   |          |                                             |
| `lead_email`  | text    | no   |          | same format check as `candidates.email`     |
| `user_id`     | bigint  | yes  |          | FK → `users`; set when the lead has a login |
| `is_active`   | boolean | no   | `true`   |                                             |
| row stamps    |         |      |          |                                             |

- Unique: one active lead per position: `UNIQUE (position_id) WHERE is_active` (P).
- Used for: invitation mails, the "own team only" restriction for the Team lead role, report filters.

### 5.5 `settings` (C: "keep the durations as editable settings, not hard-coded", section 3)

| Column        | Type        | Null | Rule            |
| ------------- | ----------- | ---- | --------------- |
| `key`         | text        | no   | PK              |
| `value`       | text        | no   |                 |
| `description` | text        | yes  |                 |
| `updated_by`  | bigint      | yes  | FK → `users`    |
| `updated_at`  | timestamptz | no   | default `now()` |

Expected keys (values from the guide): `evaluation_days` = 7, `probation_months` = 3, `junior_months` = 9, `probation_max_extension_months` = 1, `deadline_time` = 17:30, `time_zone` = Asia/Colombo, `reminder_hours_before` = 24.

- **M:** whether the 9 junior months count from the end of probation or from the joining date. This changes how the end date is calculated, not the table. It is not decided here.
- Audit: every change goes to `audit_log`.

---

## 6. Candidates

### 6.1 `candidates` (C: section 2)

Purpose: one row per applicant. Every other record links to it.

| Column              | Type    | Null | Default      | Rule                                                           | Basis |
| ------------------- | ------- | ---- | ------------ | -------------------------------------------------------------- | ----- |
| `id`                | bigint  | no   | identity     | PK; this is the `candidate_id` other tables reference          | P     |
| `candidate_code`    | text    | no   |              | UNIQUE; the Candidate ID people see                            | C     |
| `full_name`         | text    | no   |              | not blank                                                      | C     |
| `phone`             | text    | yes  |              | `CHECK (phone ~ '^\+?[0-9]{9,15}$')`; leading zero kept        | C     |
| `email`             | text    | yes  |              | `CHECK` basic shape, no spaces or line breaks                  | C     |
| `address`           | text    | yes  |              | line breaks cleaned on import                                  | C     |
| `ol_maths`          | text    | yes  |              | O/L Maths result                                               | C     |
| `al_result`         | text    | yes  |              | A/L result                                                     | C     |
| `al_stream`         | text    | yes  |              | A/L stream                                                     | C     |
| `other_education`   | text    | yes  |              |                                                                | C     |
| `position_id`       | bigint  | no   |              | FK → `positions`; applied position                             | C     |
| `source_id`         | bigint  | yes  |              | FK → `sources`                                                 | C     |
| `cv_url`            | text    | yes  |              | link to the candidate's own CV                                 | C     |
| `company_cv_url`    | text    | yes  |              | link to the filled company-format CV                           | C     |
| `company_cv_status` | text    | no   | `'not_sent'` | `CHECK IN ('not_sent','sent','received','overdue')`            | C     |
| `hr_comment`        | text    | yes  |              |                                                                | C     |
| `applied_on`        | date    | yes  |              | needed for the weekly "applications" count                     | P     |
| `is_historical`     | boolean | no   | `false`      | `true` for imported past data, so it never triggers old emails | P     |
| row stamps          |         |      |              |                                                                |       |

- **Phone is text**, never a number, so the leading zero survives (C).
- **`candidate_code` vs `id` (P):** the internal `id` is what tables link by. `candidate_code` holds the ID that is printed and searched. **M:** the format of the existing Candidate ID in the workbook, and how new ones are generated.
- **`is_historical` (P):** the guide says past data is imported "with a source = Historical flag". Using the `source` field for that would overwrite the real source (LinkedIn, ITPro and so on) and break the source report, so a separate flag is proposed.
- **`applied_on` (P):** the guide's weekly report counts applications per week, which needs a date. Whether the workbook holds one is not known.
- Indexes: unique `candidate_code`; plain indexes on `phone`, `lower(email)`, `position_id`, `source_id`, `lower(full_name)`.
- Deletion: never.
- Audit: create and every field change go to `audit_log`.

### 6.2 Duplicate prevention

Two different things, kept separate:

**Hard uniqueness (the database refuses):**

- `candidate_code` is unique. This is the only rule the guide confirms ("No duplicate candidate_id").

**Duplicate detection (the application warns, HR decides):**

- Phone and email are indexed but **not unique**. The guide does not say a phone number identifies one person. Family members share phones, and a person may apply again for another position. A unique constraint would also make the import fail on the duplicates the guide says already exist.
- When a candidate is added or imported, the application looks for an existing row with the same normalized phone, or the same email (case-insensitive), or the same name plus phone. A match shows a warning with the existing record; HR either opens the existing candidate or confirms a new one.
- During import, matches are not merged automatically. They go to the review list (`import_rows`, section 14).
- `cv_url` is not unique either. The guide says the same CV link is reused across candidates; the import flags these for review.

**M:** which match counts as "the same person" (phone, email, or both), and whether a returning applicant gets a new candidate row.

### 6.3 `candidate_files` (P: metadata only)

Purpose: details of files uploaded through the system (the guide requires the company CV to be uploaded by the candidate; section 11).

| Column              | Type        | Null | Default  | Rule                                               |
| ------------------- | ----------- | ---- | -------- | -------------------------------------------------- |
| `id`                | bigint      | no   | identity | PK                                                 |
| `candidate_id`      | bigint      | no   |          | FK → `candidates`                                  |
| `file_kind`         | text        | no   |          | `CHECK IN ('cv','company_cv','other')`             |
| `original_filename` | text        | no   |          |                                                    |
| `storage_ref`       | text        | no   |          | where the file is kept; meaning depends on storage |
| `mime_type`         | text        | yes  |          |                                                    |
| `size_bytes`        | bigint      | yes  |          | `CHECK (size_bytes >= 0)`                          |
| `uploaded_at`       | timestamptz | no   | `now()`  |                                                    |
| `uploaded_by`       | bigint      | yes  |          | FK → `users`; empty when the candidate uploaded    |

- The file itself is **not** stored in PostgreSQL. **M:** storage provider (Google Drive, a server folder, cloud storage).
- `candidates.cv_url` and `candidates.company_cv_url` remain the "current link" the guide asks for. When an upload arrives, the application adds a row here and sets `company_cv_url` and `company_cv_status = 'received'`.
- Index: `candidate_id`.

### 6.4 `candidate_upload_links` (C: "a personal upload link… works for that candidate only", section 11)

| Column         | Type        | Null | Rule                                               |
| -------------- | ----------- | ---- | -------------------------------------------------- |
| `id`           | bigint      | no   | PK                                                 |
| `candidate_id` | bigint      | no   | FK → `candidates`                                  |
| `token_hash`   | text        | no   | UNIQUE; only a hash of the link's secret is stored |
| `expires_at`   | timestamptz | no   | P: links expire                                    |
| `used_at`      | timestamptz | yes  |                                                    |
| `created_at`   | timestamptz | no   | default `now()`                                    |

---

## 7. Phone screens

### `phone_screens` (C: section 2)

| Column               | Type        | Null | Default  | Rule                                   | Basis |
| -------------------- | ----------- | ---- | -------- | -------------------------------------- | ----- |
| `id`                 | bigint      | no   | identity | PK                                     | P     |
| `candidate_id`       | bigint      | no   |          | FK → `candidates`; UNIQUE              | C     |
| `called`             | boolean     | no   | `false`  |                                        | C     |
| `response`           | text        | yes  |          | controlled list                        | C / M |
| `result`             | text        | yes  |          | `CHECK IN ('selected','not_selected')` | C     |
| `review`             | text        | yes  |          | free-text remark                       | C     |
| `interview_datetime` | timestamptz | yes  |          | direct interview slot                  | C     |
| `screened_by`        | bigint      | yes  |          | FK → `users`                           | P     |
| row stamps           |             |      |          |                                        |       |

- **Controlled values:** `called` (yes/no), `result` (Selected / Not Selected, per section 7 of the guide) and `response`. `review` stays free text.
- **M:** the allowed `response` values. They are a dropdown in tab 2 of the workbook, which has not been seen.
- **Mail sent is not a column.** The guide says the "Mail Sent" tick must come from `email_log` and never be set by hand, so it is read from `email_log` (a database view can expose it as a yes/no).
- One row per candidate (P: `UNIQUE (candidate_id)`), matching the one-row-per-candidate layout of tab 2.
- Rule checked in the application: `result = 'selected'` together with an `interview_datetime` moves the candidate to "Interview Scheduled" and triggers the invitation mail.
- Audit: result changes go to `audit_log`.

---

## 8. Interviews

### `interviews` (C: section 2)

| Column                | Type        | Null | Default     | Rule                                                 | Basis |
| --------------------- | ----------- | ---- | ----------- | ---------------------------------------------------- | ----- |
| `id`                  | bigint      | no   | identity    | PK                                                   | P     |
| `candidate_id`        | bigint      | no   |             | FK → `candidates`                                    | C     |
| `scheduled_at`        | timestamptz | no   |             | interview date and time                              | C     |
| `mode`                | text        | yes  |             | `CHECK IN ('onsite','online')`                       | C     |
| `attendance`          | text        | no   | `'pending'` | `CHECK IN ('pending','attended','not_attended')`     | C     |
| `score_technical`     | smallint    | yes  |             | `CHECK BETWEEN 0 AND 10`                             | C     |
| `score_ai`            | smallint    | yes  |             | `CHECK BETWEEN 0 AND 10`                             | C     |
| `score_communication` | smallint    | yes  |             | `CHECK BETWEEN 0 AND 10`                             | C     |
| `score_confidence`    | smallint    | yes  |             | `CHECK BETWEEN 0 AND 10`                             | C     |
| `score_culture_fit`   | smallint    | yes  |             | `CHECK BETWEEN 0 AND 10`                             | C     |
| `total_score`         | smallint    |      | generated   | sum of the five scores; cannot be typed              | C     |
| `recommendation`      | text        | yes  |             | interviewer's recommendation                         | C / M |
| `decision`            | text        | yes  |             | `CHECK IN ('selected','not_selected','on_hold')`     | C     |
| `interviewer_id`      | bigint      | yes  |             | FK → `users`                                         | C     |
| `interviewer_name`    | text        | yes  |             | for imported rows where the interviewer has no login | P     |
| `remarks`             | text        | yes  |             |                                                      | C     |
| `is_historical`       | boolean     | no   | `false`     | imported past interview                              | P     |
| row stamps            |             |      |             |                                                      |       |

**Total out of 50: calculated by the database (recommended).**

```
total_score smallint GENERATED ALWAYS AS (
  score_technical + score_ai + score_communication + score_confidence + score_culture_fit
) STORED
```

Why the database and not the application:

- Nobody can type or import a total that disagrees with the five scores, because the column cannot be written to.
- Reports, exports and the import all read the same number without repeating the formula.
- If any score is missing the total is empty, which is correct: there is no total yet.

**Score rules enforced by the database:**

- Each score is a whole number from 0 to 10.
- Either all five scores are filled or none are: `CHECK (num_nulls(score_technical, score_ai, score_communication, score_confidence, score_culture_fit) IN (0, 5))`. This stops a half-scored interview producing a misleading total.

**Rules checked in the application:**

- A new (non-historical) interview needs all five scores before a decision can be saved. This is not a database rule because the older interview log (tab 7) has decisions without scores.
- `decision = 'selected'` creates the offer row automatically (C: acceptance checklist).
- `decision = 'on_hold'` requires a hold reason (stored in `pipeline_status`).

Other notes:

- `decision` replaces the free-text "status" of tab 3 (C: guide lists this as a gap).
- A candidate can have several interviews (rescheduled or repeated), so `candidate_id` is not unique.
- **M:** whether `recommendation` is a fixed list, and its values.
- Indexes: `candidate_id`, `scheduled_at`, `interviewer_id`.
- Audit: score and decision changes go to `audit_log`.

---

## 9. Offers and salary

### 9.1 The conflict in the guide

- Section 2 lists `salary_lkr` as a field of `offers`.
- The access-control section says: "Store salary in a separate table (`offer_salary`) linked by candidate_id. Only the Main user role can read or edit it."

**Recommended (safer) model: salary lives only in `offer_salary`. `offers` has no salary column.**

Reasons:

- Every screen, report and export that reads `offers` is then salary-free by construction. A mistake in one query cannot leak a salary.
- One table to protect, one place to log access.
- If salary were also in `offers`, the HR and Team lead roles, who must see offers, would be one `SELECT *` away from seeing it.

**M: this must be confirmed before the offer tables are built.**

### 9.2 `offers` (C: section 2, minus salary)

| Column            | Type    | Null | Default   | Rule                                              | Basis |
| ----------------- | ------- | ---- | --------- | ------------------------------------------------- | ----- |
| `id`              | bigint  | no   | identity  | PK                                                | P     |
| `candidate_id`    | bigint  | no   |           | FK → `candidates`                                 | C     |
| `interview_id`    | bigint  | yes  |           | FK → `interviews`; the interview that led to it   | P     |
| `position_id`     | bigint  | no   |           | FK → `positions`                                  | C     |
| `offer_date`      | date    | yes  |           |                                                   | C     |
| `work_mode`       | text    | yes  |           | controlled list                                   | C / M |
| `location`        | text    | yes  |           |                                                   | C     |
| `offer_status`    | text    | no   | `'draft'` | `CHECK IN ('draft','sent','accepted','rejected')` | C / P |
| `onboarding_date` | date    | yes  |           | joining date                                      | C     |
| `attended`        | boolean | yes  |           | empty until the joining day                       | C     |
| row stamps        |         |      |           |                                                   |       |

- **Email status is not a column.** As with phone screens, it is read from `email_log` (Not sent / Sent / Failed).
- Unique: one open offer per candidate: `UNIQUE (candidate_id) WHERE offer_status <> 'rejected'` (P).
- Check: `attended` can only be set when `onboarding_date` is filled.
- Rule checked in the application: `onboarding_date` set and `attended = true` creates the employee and the 7-day evaluation (C).
- **M:** the allowed `work_mode` values (a dropdown in tab 4).
- **P:** the four `offer_status` values. The guide names "Offer Sent" and "Offer Accepted" as stages and "Offer Rejected" in the import rules.
- Indexes: `candidate_id`, `onboarding_date`, `offer_status`.

### 9.3 `offer_salary` (C: access-control section; M: see 9.1)

| Column       | Type          | Null | Default  | Rule                     |
| ------------ | ------------- | ---- | -------- | ------------------------ |
| `id`         | bigint        | no   | identity | PK                       |
| `offer_id`   | bigint        | no   |          | FK → `offers`; UNIQUE    |
| `salary_lkr` | numeric(12,2) | no   |          | `CHECK (salary_lkr > 0)` |
| row stamps   |               |      |          |                          |

- **Linked by `offer_id`, not `candidate_id` (P).** The guide says "linked by candidate_id". A salary belongs to one offer, and a candidate can have a second offer after rejecting the first, so linking to the offer is unambiguous. The candidate is still reached through the offer.
- Access: only requests with the `salary.view` / `salary.edit` permission may touch this table, checked in the backend. Reports show "Restricted" for everyone else (C).
- Salary values never go into `audit_log`, `email_log`, notifications or exports for other roles (C).
- Deletion: never.

### 9.4 `salary_access_log` (C: "log every view and change of a salary record (who, when)")

| Column            | Type        | Null | Default  | Rule                                        |
| ----------------- | ----------- | ---- | -------- | ------------------------------------------- |
| `id`              | bigint      | no   | identity | PK                                          |
| `offer_salary_id` | bigint      | no   |          | FK → `offer_salary`                         |
| `user_id`         | bigint      | no   |          | FK → `users`                                |
| `action`          | text        | no   |          | `CHECK IN ('view','create','update')`       |
| `context`         | text        | yes  |          | where it happened, e.g. `profile`, `report` |
| `occurred_at`     | timestamptz | no   | `now()`  |                                             |

- Records who and when. **It does not record the amount.**
- Append-only: the application never updates or deletes rows.
- Kept separate from `audit_log` because it also records _views_, which the general audit does not, and because only the Main user may read it.
- Indexes: `offer_salary_id`, `user_id`, `occurred_at`.

---

## 10. Pipeline status and history

### 10.1 Two options

|                        | A. Current-status table plus history table                     | B. History only, current state derived               |
| ---------------------- | -------------------------------------------------------------- | ---------------------------------------------------- |
| Current stage          | one row per candidate, read directly                           | "latest row per candidate" query every time          |
| Candidate list filters | simple `WHERE current_stage = …` with an index                 | window function or subquery on every list and report |
| Required reasons       | a `CHECK` on the current row enforces hold and reject reasons  | harder to express as a constraint                    |
| History kept           | yes, in the history table                                      | yes                                                  |
| Risk                   | the two tables drift apart if one is written without the other | none of that kind                                    |

**Recommendation: A.** It matches the guide's `pipeline_status` table, keeps everyday queries simple enough for a beginner to maintain, and lets the database enforce the required reasons. The drift risk is handled by writing both rows in one transaction, through one function in the backend that is the only code allowed to change a stage.

### 10.2 `pipeline_status` (C: section 2)

One row per candidate: where the candidate is now.

| Column               | Type        | Null | Default     | Rule                                    | Basis |
| -------------------- | ----------- | ---- | ----------- | --------------------------------------- | ----- |
| `candidate_id`       | bigint      | no   |             | PK; FK → `candidates`                   | C     |
| `current_stage`      | text        | no   | `'applied'` | `CHECK IN (…stage list…)`               | C     |
| `hold_reason`        | text        | yes  |             | required when on hold                   | C     |
| `reject_reason`      | text        | yes  |             | required when rejected                  | C     |
| `next_followup_date` | date        | yes  |             | also serves as the on-hold revisit date | C     |
| `responsible_hr_id`  | bigint      | yes  |             | FK → `users`                            | C     |
| `stage_changed_at`   | timestamptz | no   | `now()`     |                                         | P     |
| `updated_by`         | bigint      | yes  |             | FK → `users`                            | C     |

**Stage list (C: section 2):** applied, phone_screened, interview_scheduled, interviewed, selected, offer_sent, offer_accepted, joined, on_hold, rejected, not_attended, no_response.

- **M:** the guide's import rules map "Not Accepted by Candidate" to "Offer Rejected", which is not in the stage list. Is `offer_rejected` a stage?
- **After joining (P):** the guide also lists Evaluation, Probation, Junior, Senior, Discontinued and Terminated as candidate stages. To avoid storing the same fact twice, the pipeline stops at `joined`, and everything after that is read from `employees` (section 11). A view can show one combined status per person.

**Checks enforced by the database:**

- `CHECK (current_stage <> 'on_hold' OR hold_reason IS NOT NULL)`: hold reason is required when on hold (C).
- `CHECK (current_stage <> 'rejected' OR reject_reason IS NOT NULL)`: reject reason is required when rejected (C).

Index: `current_stage`, `next_followup_date`, `responsible_hr_id`.

### 10.3 `stage_history` (C: "every status change stores who changed it and when", section 8)

| Column         | Type        | Null | Default  | Rule                          |
| -------------- | ----------- | ---- | -------- | ----------------------------- |
| `id`           | bigint      | no   | identity | PK                            |
| `candidate_id` | bigint      | no   |          | FK → `candidates`             |
| `from_stage`   | text        | yes  |          | empty for the first row       |
| `to_stage`     | text        | no   |          | same list as `current_stage`  |
| `reason`       | text        | yes  |          | hold or reject reason, if any |
| `changed_by`   | bigint      | yes  |          | FK → `users`; empty = system  |
| `changed_at`   | timestamptz | no   | `now()`  |                               |

- Append-only. Rows are never updated or deleted, so no earlier state is lost.
- Feeds the candidate profile timeline and the "stage rejected at" column of the rejected report.
- Index: (`candidate_id`, `changed_at`).

---

## 11. Employee lifecycle

How a candidate becomes an employee (C: section 3): when an offer has an onboarding date and `attended = true`, the backend creates the `employees` row and the first `phase_history` row (evaluation) in one transaction.

### 11.1 `employees` (C: section 2)

| Column             | Type   | Null | Default        | Rule                                                    | Basis |
| ------------------ | ------ | ---- | -------------- | ------------------------------------------------------- | ----- |
| `id`               | bigint | no   | identity       | PK                                                      | P     |
| `candidate_id`     | bigint | no   |                | FK → `candidates`; UNIQUE                               | C     |
| `offer_id`         | bigint | yes  |                | FK → `offers`; empty for imported staff                 | P     |
| `join_date`        | date   | no   |                |                                                         | C     |
| `track`            | text   | no   |                | `CHECK IN ('intern','staff')`                           | C     |
| `current_phase`    | text   | no   | `'evaluation'` | `CHECK IN ('evaluation','probation','junior','senior')` | C     |
| `phase_start`      | date   | no   |                |                                                         | C     |
| `phase_end`        | date   | yes  |                | empty only for senior                                   | C     |
| `status`           | text   | no   | `'active'`     | `CHECK IN ('active','discontinued','terminated')`       | C     |
| `exit_date`        | date   | yes  |                | required when not active                                | C     |
| `exit_reason`      | text   | yes  |                | required when not active                                | C     |
| `exit_approved_by` | bigint | yes  |                | FK → `users`; the terminated report shows this          | C     |
| row stamps         |        |      |                |                                                         |       |

- `status` is the guide's "outcome". All active employees display as "Currently Working" (C).
- **Checks enforced by the database:**
  - `CHECK (status = 'active' OR (exit_date IS NOT NULL AND exit_reason IS NOT NULL))`: a reason is required when discontinued or terminated (C).
  - `CHECK (current_phase = 'senior' OR phase_end IS NOT NULL)`.
  - `CHECK (phase_end IS NULL OR phase_end >= phase_start)`.
- `current_phase`, `phase_start` and `phase_end` repeat the latest `phase_history` row. The guide asks for them here; they are updated in the same transaction as the history row.
- **Existing staff with no candidate record (P):** the one-time staff import creates a minimal `candidates` row (`is_historical = true`) for each, so names and contact details live in one place and `candidate_id` stays required. **M:** confirm this, or allow employees without a candidate.
- **M: Discontinued vs Terminated.** The guide's working definition: Discontinued = left or stopped during evaluation or probation; Terminated = ended by the company after probation passed. It marks this "to confirm with HR". If confirmed, the application refuses `terminated` before probation has passed.
- Indexes: unique `candidate_id`; `status`, `current_phase`, `phase_end`.

### 11.2 `phase_history` (C: section 2 and 3)

One row per phase an employee has been in, plus one row per extension.

| Column           | Type        | Null | Default  | Rule                                                    | Basis |
| ---------------- | ----------- | ---- | -------- | ------------------------------------------------------- | ----- |
| `id`             | bigint      | no   | identity | PK                                                      | P     |
| `employee_id`    | bigint      | no   |          | FK → `employees`                                        | C     |
| `phase`          | text        | no   |          | `CHECK IN ('evaluation','probation','junior','senior')` | C     |
| `start_date`     | date        | no   |          |                                                         | C     |
| `end_date`       | date        | yes  |          | empty only for senior                                   | C     |
| `is_extension`   | boolean     | no   | `false`  | `true` for a probation extension row                    | C     |
| `result`         | text        | yes  |          | `CHECK IN ('pass','extend','discontinue')`              | C     |
| `result_reason`  | text        | yes  |          | required when the result is discontinue                 | C     |
| `review_doc_url` | text        | yes  |          | link to the review document                             | C     |
| `reviewed_by`    | bigint      | yes  |          | FK → `users`                                            | C     |
| `decided_at`     | timestamptz | yes  |          |                                                         | P     |
| row stamps       |             |      |          |                                                         |       |

- The guide links this table by `candidate_id`; `employee_id` is proposed because phases belong to the employment (P).
- **Checks enforced by the database:**
  - `CHECK (phase = 'senior' OR end_date IS NOT NULL)` and `CHECK (end_date IS NULL OR end_date >= start_date)`.
  - `CHECK (result <> 'discontinue' OR result_reason IS NOT NULL)`.
  - `CHECK (result <> 'extend' OR phase = 'probation')`: only probation can be extended (C).
  - `CHECK (NOT is_extension OR phase = 'probation')`.
  - One open phase per employee: `UNIQUE (employee_id) WHERE result IS NULL`.
- **History is never overwritten.** A gate decision fills `result` on the open row and inserts the next row. An extension inserts a new probation row with `is_extension = true` (C).
- **Dates** are calculated by the application from `settings` when the row is created, and must reproduce the guide's worked example (join 2 Nov 2026 → evaluation to 8 Nov 2026 → probation 9 Nov 2026 to 8 Feb 2027 → junior 9 Feb 2027 to 8 Nov 2027 → senior from 9 Nov 2027).
- **M: the junior end date** depends on the 9-month question in section 5.5. Not decided here.
- The maximum one-month extension is checked in the application against `probation_max_extension_months`.
- Open point (not blocking): tab 8 has 7th-day, 1-month, 3-month and 6-month review links. 7th-day and 3-month map to the evaluation and probation rows. Where the 1-month and 6-month links belong needs an HR answer during import.
- Indexes: `employee_id`, `end_date`.

### 11.3 `company_accounts` (C: section 11)

| Column             | Type   | Null | Default       | Rule                                                         |
| ------------------ | ------ | ---- | ------------- | ------------------------------------------------------------ |
| `id`               | bigint | no   | identity      | PK                                                           |
| `employee_id`      | bigint | no   |               | FK → `employees`; UNIQUE                                     |
| `company_email`    | text   | yes  |               | UNIQUE on `lower(company_email)`; empty while only requested |
| `status`           | text   | no   | `'requested'` | `CHECK IN ('requested','created','handed_over','disabled')`  |
| `created_date`     | date   | yes  |               | when IT created the account                                  |
| `handed_over_date` | date   | yes  |               |                                                              |
| `disabled_date`    | date   | yes  |               |                                                              |
| row stamps         |        |      |               |                                                              |

- **No password column.** The guide first recommends not storing the password at all, then records a decision to store it encrypted and visible to the Main user only. **M:** which applies. If storing is confirmed, it goes in a separate table holding only an encrypted value, with its own access log on the same pattern as `salary_access_log`, and the value is deleted after the first password change (C).
- "Disable company account" follow-up (C): employees whose status is discontinued or terminated and whose account is not `disabled` form the IT task list. No separate task table is proposed.

---

## 12. Notifications and email

### 12.1 How the two tables divide the work (P)

The guide says in one place that mails are recorded in `email_log`, and in another that they are recorded in the `notifications` table. Proposed split:

- **`notifications`** is the schedule: what must be sent, to whom, and when.
- **`email_log`** is the record: every mail the system actually tried to send, whether triggered by a notification or by an HR click.

### 12.2 `notifications` (C: section 4)

| Column             | Type        | Null | Default     | Rule                                               | Basis |
| ------------------ | ----------- | ---- | ----------- | -------------------------------------------------- | ----- |
| `id`               | bigint      | no   | identity    | PK                                                 | C     |
| `candidate_id`     | bigint      | no   |             | FK → `candidates`                                  | C     |
| `type`             | text        | no   |             | `CHECK IN (…type list…)`                           | C     |
| `phase_history_id` | bigint      | yes  |             | FK → `phase_history`                               | P     |
| `interview_id`     | bigint      | yes  |             | FK → `interviews`                                  | P     |
| `offer_id`         | bigint      | yes  |             | FK → `offers`                                      | P     |
| `due_at`           | timestamptz | no   |             | the deadline itself (end date at 17:30)            | C     |
| `send_at`          | timestamptz | no   |             | `due_at` minus 24 hours                            | C     |
| `sent_at`          | timestamptz | yes  |             | empty until sent                                   | C     |
| `recipients`       | text[]      | no   |             | email addresses                                    | C     |
| `status`           | text        | no   | `'pending'` | `CHECK IN ('pending','sent','failed','cancelled')` | C     |
| `attempts`         | integer     | no   | `0`         |                                                    | P     |
| `last_error`       | text        | yes  |             |                                                    | C     |
| `created_at`       | timestamptz | no   | `now()`     |                                                    | P     |

**Types (C):** `evaluation_end`, `probation_end`, `junior_end`, `interview_reminder`, `joining_reminder`, `cv_pending`.

**Which row is eligible to send.** The guide's rule is: the job runs every 15 minutes and picks rows where **`send_at <= now` and `sent_at` is empty**.

> Note: the task brief for this document states the rule as "`due_at <= current time` and `sent_at IS NULL`". `due_at` is the deadline, so that wording would send the reminder at the deadline instead of 24 hours before it. This design follows the guide and uses `send_at`. `due_at` is still stored so the mail can state the deadline.

Full condition: `status = 'pending' AND sent_at IS NULL AND send_at <= now()`.

**Duplicate prevention, enforced by the database:**

- Exactly one of the three reference columns is filled: `CHECK (num_nonnulls(phase_history_id, interview_id, offer_id) = 1)`.
- At most one live reminder of a type per subject, for example `UNIQUE (type, phase_history_id) WHERE status <> 'cancelled'`, and the same for `interview_id` and `offer_id`.
- `CHECK ((status = 'sent') = (sent_at IS NOT NULL))`.
- The job marks a row as sent in the same transaction that claims it (`SELECT … FOR UPDATE SKIP LOCKED`), so two overlapping runs cannot send the same row.

**Date changes (C):** on an extension or correction the old row is set to `cancelled` and a new row is inserted. Nothing is edited in place, so the log shows what happened.

**Very short phases (C):** if `send_at` is already in the past when the row is created, it is simply eligible on the next run, which gives the "send immediately" behaviour.

Index: `(send_at) WHERE status = 'pending'`; `candidate_id`.

In-app alerts (C) are shown from these rows. Per-user "read" marks are not in the guide and are not designed here.

### 12.3 `email_templates` (C: section 5)

| Column      | Type    | Null | Default    | Rule                                                     |
| ----------- | ------- | ---- | ---------- | -------------------------------------------------------- |
| `id`        | bigint  | no   | identity   | PK                                                       |
| `type`      | text    | no   |            | UNIQUE; e.g. `interview_invitation`                      |
| `subject`   | text    | no   |            | may contain placeholders such as `{name}`                |
| `body`      | text    | no   |            | may contain placeholders                                 |
| `send_mode` | text    | no   | `'review'` | `CHECK IN ('auto','review')`; auto-send or preview first |
| `is_active` | boolean | no   | `true`     |                                                          |
| row stamps  |         |      |            |                                                          |

- Templates are edited, not deleted. Changes go to `audit_log`.

### 12.4 `email_log` (C: section 5)

| Column            | Type        | Null | Default    | Rule                                      | Basis |
| ----------------- | ----------- | ---- | ---------- | ----------------------------------------- | ----- |
| `id`              | bigint      | no   | identity   | PK                                        | P     |
| `candidate_id`    | bigint      | yes  |            | FK → `candidates`; empty for report mails | C     |
| `template_id`     | bigint      | no   |            | FK → `email_templates`                    | C     |
| `notification_id` | bigint      | yes  |            | FK → `notifications`                      | P     |
| `to_addresses`    | text[]      | no   |            |                                           | C     |
| `cc_addresses`    | text[]      | yes  |            |                                           | C     |
| `subject_sent`    | text        | no   |            | the subject actually sent                 | P     |
| `body_sent`       | text        | yes  |            | the text actually sent, after any HR edit | P     |
| `status`          | text        | no   | `'queued'` | `CHECK IN ('queued','sent','failed')`     | C     |
| `error`           | text        | yes  |            |                                           | C     |
| `is_resend`       | boolean     | no   | `false`    | `true` only when HR pressed Resend        | C     |
| `sent_by`         | bigint      | yes  |            | FK → `users`; empty for automatic mails   | P     |
| `sent_at`         | timestamptz | yes  |            |                                           | C     |
| `created_at`      | timestamptz | no   | `now()`    |                                           | P     |

**"Never send the same template twice to the same candidate unless HR presses Resend" (C), enforced by the database:**

```
UNIQUE (candidate_id, template_id) WHERE is_resend = false AND status IN ('queued', 'sent')
```

- A second ordinary send of the same template to the same candidate is refused.
- A failed send does not block a retry.
- A resend is a separate row with `is_resend = true`, so it is logged and allowed (C).

Other notes:

- The "Mail Sent" status per candidate (Not sent / Sent / Failed) is read from this table (C).
- Salary never appears in `subject_sent` or `body_sent` (C). Company account passwords are never mailed (C).
- Append-only apart from the status moving from `queued` to `sent` or `failed`.
- **M: WhatsApp/SMS.** The guide says "also offer a WhatsApp/SMS text". If that is in scope, a `channel` column is added here; if not, nothing changes.
- Indexes: `candidate_id`, `template_id`, `sent_at`.

---

## 13. Audit

### `audit_log` (C: "every status change stores who changed it and when"; P: table shape)

| Column          | Type        | Null | Default  | Rule                                                     |
| --------------- | ----------- | ---- | -------- | -------------------------------------------------------- |
| `id`            | bigint      | no   | identity | PK                                                       |
| `actor_user_id` | bigint      | yes  |          | FK → `users`; empty = the system (scheduled job)         |
| `action`        | text        | no   |          | `CHECK IN ('create','update','delete','login','export')` |
| `entity_type`   | text        | no   |          | table name, e.g. `candidates`                            |
| `entity_id`     | bigint      | yes  |          | the row's `id`                                           |
| `old_values`    | jsonb       | yes  |          | only the fields that changed                             |
| `new_values`    | jsonb       | yes  |          | only the fields that changed                             |
| `occurred_at`   | timestamptz | no   | `now()`  |                                                          |

- **Append-only.** The application never updates or deletes audit rows.
- **Never contains:** salary amounts, passwords or password hashes, upload-link tokens. Those fields are removed before the row is written.
- Stage changes and phase decisions also have their own history tables (`stage_history`, `phase_history`) because the application reads them every day. `audit_log` is the general safety net for everything else.
- Salary views are **not** here; they are in `salary_access_log` (section 9.4).
- Indexes: (`entity_type`, `entity_id`), `actor_user_id`, `occurred_at`.
- P, for later: have migrations run as a separate owner role, so the runtime login can be denied `UPDATE` and `DELETE` on the three log tables at database level.

---

## 14. Import readiness

Nothing is imported now. These two tables let the later import be controlled and reviewable (C: section 10 asks for an import report with rows imported, matched and needing review, signed off by HR).

### 14.1 `import_batches` (P)

| Column             | Type        | Null | Rule                                                     |
| ------------------ | ----------- | ---- | -------------------------------------------------------- |
| `id`               | bigint      | no   | PK                                                       |
| `source_file_name` | text        | no   |                                                          |
| `source_tab`       | text        | no   | workbook tab name                                        |
| `status`           | text        | no   | `CHECK IN ('running','completed','failed','signed_off')` |
| `rows_total`       | integer     | no   | default 0                                                |
| `rows_imported`    | integer     | no   | default 0                                                |
| `rows_matched`     | integer     | no   | default 0                                                |
| `rows_review`      | integer     | no   | default 0                                                |
| `started_at`       | timestamptz | no   | default `now()`                                          |
| `finished_at`      | timestamptz | yes  |                                                          |
| `imported_by`      | bigint      | yes  | FK → `users`                                             |
| `signed_off_by`    | bigint      | yes  | FK → `users`                                             |

### 14.2 `import_rows` (P)

| Column              | Type        | Null | Rule                                                               |
| ------------------- | ----------- | ---- | ------------------------------------------------------------------ |
| `id`                | bigint      | no   | PK                                                                 |
| `batch_id`          | bigint      | no   | FK → `import_batches`                                              |
| `source_row_number` | integer     | no   | row in the workbook tab                                            |
| `raw_data`          | jsonb       | no   | the row exactly as read                                            |
| `status`            | text        | no   | `CHECK IN ('imported','matched','needs_review','skipped','error')` |
| `issues`            | text[]      | yes  | issue codes, see below                                             |
| `message`           | text        | yes  |                                                                    |
| `candidate_id`      | bigint      | yes  | FK → `candidates`; the row created or matched                      |
| `reviewed_by`       | bigint      | yes  | FK → `users`                                                       |
| `reviewed_at`       | timestamptz | yes  |                                                                    |
| `resolution`        | text        | yes  | what HR decided                                                    |

- Unique: (`batch_id`, `source_row_number`).
- `raw_data` holds personal data and is restricted like the candidate tables. It can be cleared once HR has signed the batch off.

### 14.3 How the design handles each import problem

| Problem in the guide                              | Handled by                                                                                                    |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Duplicate candidates                              | soft matching (section 6.2); issue `duplicate_candidate`; row goes to review, no automatic merge              |
| Phone stored as number, leading 0 lost            | `phone` is text; the import restores the leading 0; rows that still fail the format check get `invalid_phone` |
| Dates stored as text, mixed formats               | columns are `date` / `timestamptz`; unparseable or ambiguous values get `invalid_date` for HR to confirm      |
| Inconsistent position names                       | `position_aliases`; an unknown spelling gets `unknown_position`                                               |
| Same CV link reused                               | `cv_url` is not unique; issue `duplicate_cv_link`                                                             |
| Interview log rows without a Candidate ID (tab 7) | matched by phone, then by name; `status = 'matched'` with the `candidate_id`                                  |
| Unmatched rows                                    | `status = 'needs_review'`; created as new candidates only after review                                        |
| Import errors                                     | `status = 'error'` with `message`; the batch counts feed the import report                                    |
| Old data triggering old emails                    | imported rows have `is_historical = true`; no notifications are created for past dates                        |
| Status words in old tabs                          | mapped to the stage list during import (the guide gives the mapping)                                          |

---

## 15. Table list

| #   | Table                    | Replaces / supports         | Basis |
| --- | ------------------------ | --------------------------- | ----- |
| 1   | `candidates`             | Tab 1                       | C     |
| 2   | `phone_screens`          | Tab 2                       | C     |
| 3   | `interviews`             | Tab 3, Tab 7                | C     |
| 4   | `offers`                 | Tab 4                       | C     |
| 5   | `offer_salary`           | salary confidentiality      | C / M |
| 6   | `pipeline_status`        | Tabs 5, 6, Follow_Up        | C     |
| 7   | `employees`              | Tab 8                       | C     |
| 8   | `phase_history`          | Tab 8 review columns        | C     |
| 9   | `notifications`          | 24-hour reminders           | C     |
| 10  | `team_leads`             | mail routing                | C     |
| 11  | `email_templates`        | mail automation             | C     |
| 12  | `email_log`              | mail automation             | C     |
| 13  | `company_accounts`       | company email tracking      | C     |
| 14  | `settings`               | editable phase durations    | C     |
| 15  | `position_aliases`       | position-name merge table   | C     |
| 16  | `candidate_upload_links` | personal CV upload link     | C     |
| 17  | `salary_access_log`      | "log every view and change" | C     |
| 18  | `stage_history`          | "who changed it and when"   | C     |
| 19  | `positions`              | closed list                 | P     |
| 20  | `sources`                | closed list                 | P     |
| 21  | `candidate_files`        | CV upload metadata          | P     |
| 22  | `users`                  | login and attribution       | P     |
| 23  | `roles`                  | access control              | P     |
| 24  | `permissions`            | access control              | P     |
| 25  | `role_permissions`       | access control              | P     |
| 26  | `audit_log`              | change history              | P     |
| 27  | `import_batches`         | import report               | P     |
| 28  | `import_rows`            | import review list          | P     |

No concept is stored twice, with two deliberate exceptions that the guide itself asks for: `employees.current_phase` (a copy of the latest `phase_history` row) and `pipeline_status.current_stage` (a copy of the latest `stage_history` row). Both are written in the same transaction as the history row.

---

## 16. Decisions needed before the schema can be built

Only items that change the tables, their constraints or their seed data.

- [ ] **1. Salary storage.** Confirm salary lives only in `offer_salary`, with no salary column in `offers` (section 9.1).
- [ ] **2. Salary viewing.** Confirm only the Main user role may view and edit salary, and that every view is logged.
- [ ] **3. Stage list.** Is "Offer Rejected" a stage? Confirm the twelve pre-joining stages are final (section 10.2).
- [ ] **4. Discontinued vs Terminated.** Confirm the definitions, and that both require a date and reason (section 11.1).
- [ ] **5. Junior period.** Nine months after probation ends, or nine months from joining? (Changes the date calculation and the worked example, not the tables.)
- [ ] **6. Approved values.** The lists of positions and sources, and the position-name mapping. Also the dropdown values for phone-screen `response`, interview `recommendation` and offer `work_mode`.
- [ ] **7. Roles and login.** The final role list (is "manager" the team lead? does IT get a login?) and the login method (email and password, or company Google sign-in).
- [ ] **8. Company account passwords.** Never stored, or stored encrypted for the Main user only? (Decides whether a secrets table exists.)
- [ ] **9. CV storage.** Where uploaded files are kept (decides what `storage_ref` holds).
- [ ] **10. WhatsApp/SMS.** In scope or not? (Decides whether `email_log` needs a `channel` column.)
- [ ] **11. Candidate ID.** The format of the existing Candidate ID and how new ones are generated; and whether existing staff with no candidate record get a minimal candidate row (sections 6.1 and 11.1).

Access to a copy of the workbook, or a dummy version with the same columns and dropdowns, would settle items 6 and 11 directly.
