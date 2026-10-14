# Status Value Mapping — Workbook words → System values (2026-10-14)

**Status: DRAFT FOR REVIEW.** The workbook's actual status words have not been seen, so no source spelling is approved yet. The Target Value column lists the only values the current schema accepts (verified against live CHECK constraints and the seeded `pipeline_stages` rows). Every real source spelling found in the workbook must be added here and approved before import; an unlisted or ambiguous value is never silently normalized — it goes to review.

Mapping Status values: APPROVED, REVIEW REQUIRED, NOT USED.

## Candidate pipeline (`pipeline_status.current_stage` — 12 seeded stages)

| Source Value                        | Context        | Target Value          | Mapping Status  | Notes                                              |
| ----------------------------------- | -------------- | --------------------- | --------------- | -------------------------------------------------- |
| SOURCE COLUMN CONFIRMATION REQUIRED | pipeline stage | `applied`             | REVIEW REQUIRED | guide's status-word mapping list not yet obtained  |
| SOURCE COLUMN CONFIRMATION REQUIRED | pipeline stage | `phone_screened`      | REVIEW REQUIRED |                                                    |
| SOURCE COLUMN CONFIRMATION REQUIRED | pipeline stage | `interview_scheduled` | REVIEW REQUIRED |                                                    |
| SOURCE COLUMN CONFIRMATION REQUIRED | pipeline stage | `interviewed`         | REVIEW REQUIRED |                                                    |
| SOURCE COLUMN CONFIRMATION REQUIRED | pipeline stage | `selected`            | REVIEW REQUIRED |                                                    |
| SOURCE COLUMN CONFIRMATION REQUIRED | pipeline stage | `offer_sent`          | REVIEW REQUIRED |                                                    |
| SOURCE COLUMN CONFIRMATION REQUIRED | pipeline stage | `offer_accepted`      | REVIEW REQUIRED |                                                    |
| SOURCE COLUMN CONFIRMATION REQUIRED | pipeline stage | `joined`              | REVIEW REQUIRED |                                                    |
| SOURCE COLUMN CONFIRMATION REQUIRED | pipeline stage | `on_hold`             | REVIEW REQUIRED |                                                    |
| SOURCE COLUMN CONFIRMATION REQUIRED | pipeline stage | `rejected`            | REVIEW REQUIRED |                                                    |
| SOURCE COLUMN CONFIRMATION REQUIRED | pipeline stage | `not_attended`        | REVIEW REQUIRED |                                                    |
| SOURCE COLUMN CONFIRMATION REQUIRED | pipeline stage | `no_response`         | REVIEW REQUIRED |                                                    |
| "Offer Rejected" (if present)       | pipeline stage | —                     | REVIEW REQUIRED | not a stage in the current list; mentor decision 3 |

## Phone interview (`phone_screens`)

| Source Value                        | Context  | Target Value     | Mapping Status  | Notes                                                                                                       |
| ----------------------------------- | -------- | ---------------- | --------------- | ----------------------------------------------------------------------------------------------------------- |
| SOURCE COLUMN CONFIRMATION REQUIRED | result   | `selected`       | REVIEW REQUIRED |                                                                                                             |
| SOURCE COLUMN CONFIRMATION REQUIRED | result   | `not_selected`   | REVIEW REQUIRED |                                                                                                             |
| (dropdown values of Tab 2)          | response | —                | REVIEW REQUIRED | allowed `response` list is itself unconfirmed (mentor/proposal decision 6); no target list exists to map to |
| SOURCE COLUMN CONFIRMATION REQUIRED | called   | `true` / `false` | REVIEW REQUIRED | the tick/word used for "called" in Tab 2 is unknown                                                         |

## Direct interview (`interviews`)

| Source Value                        | Context        | Target Value    | Mapping Status  | Notes                                          |
| ----------------------------------- | -------------- | --------------- | --------------- | ---------------------------------------------- |
| SOURCE COLUMN CONFIRMATION REQUIRED | attendance     | `attended`      | REVIEW REQUIRED |                                                |
| SOURCE COLUMN CONFIRMATION REQUIRED | attendance     | `not_attended`  | REVIEW REQUIRED |                                                |
| SOURCE COLUMN CONFIRMATION REQUIRED | decision       | `selected`      | REVIEW REQUIRED |                                                |
| SOURCE COLUMN CONFIRMATION REQUIRED | decision       | `not_selected`  | REVIEW REQUIRED |                                                |
| SOURCE COLUMN CONFIRMATION REQUIRED | decision       | `on_hold`       | REVIEW REQUIRED |                                                |
| (recommendation wordings)           | recommendation | free text today | REVIEW REQUIRED | allowed list unconfirmed (proposal decision 6) |

## Offer (`offers`)

| Source Value                        | Context      | Target Value     | Mapping Status  | Notes                                                                                                     |
| ----------------------------------- | ------------ | ---------------- | --------------- | --------------------------------------------------------------------------------------------------------- |
| SOURCE COLUMN CONFIRMATION REQUIRED | offer_status | `sent`           | REVIEW REQUIRED |                                                                                                           |
| SOURCE COLUMN CONFIRMATION REQUIRED | offer_status | `accepted`       | REVIEW REQUIRED |                                                                                                           |
| SOURCE COLUMN CONFIRMATION REQUIRED | work_mode    | `office`         | REVIEW REQUIRED | only value the schema accepts (migration 007, temporary); any other source value cannot be imported today |
| SOURCE COLUMN CONFIRMATION REQUIRED | attended     | `true` / `false` | REVIEW REQUIRED |                                                                                                           |
| any salary-related value            | salary       | —                | NOT USED        | salary import blocked; MENTOR CONFIRMATION REQUIRED                                                       |

## Employee lifecycle (`employees`, `phase_history`)

| Source Value                        | Context         | Target Value   | Mapping Status  | Notes                                       |
| ----------------------------------- | --------------- | -------------- | --------------- | ------------------------------------------- |
| SOURCE COLUMN CONFIRMATION REQUIRED | track           | `intern`       | REVIEW REQUIRED |                                             |
| SOURCE COLUMN CONFIRMATION REQUIRED | track           | `staff`        | REVIEW REQUIRED |                                             |
| SOURCE COLUMN CONFIRMATION REQUIRED | current_phase   | `evaluation`   | REVIEW REQUIRED |                                             |
| SOURCE COLUMN CONFIRMATION REQUIRED | current_phase   | `probation`    | REVIEW REQUIRED |                                             |
| SOURCE COLUMN CONFIRMATION REQUIRED | current_phase   | `junior`       | REVIEW REQUIRED |                                             |
| SOURCE COLUMN CONFIRMATION REQUIRED | current_phase   | `senior`       | REVIEW REQUIRED |                                             |
| SOURCE COLUMN CONFIRMATION REQUIRED | employee status | `active`       | REVIEW REQUIRED |                                             |
| SOURCE COLUMN CONFIRMATION REQUIRED | employee status | `discontinued` | REVIEW REQUIRED | definition vs terminated: mentor decision 4 |
| SOURCE COLUMN CONFIRMATION REQUIRED | employee status | `terminated`   | REVIEW REQUIRED |                                             |
| SOURCE COLUMN CONFIRMATION REQUIRED | phase result    | `pass`         | REVIEW REQUIRED |                                             |
| SOURCE COLUMN CONFIRMATION REQUIRED | phase result    | `extend`       | REVIEW REQUIRED |                                             |
| SOURCE COLUMN CONFIRMATION REQUIRED | phase result    | `discontinue`  | REVIEW REQUIRED |                                             |

## Candidate company-CV status (`candidates.company_cv_status`)

| Source Value                        | Context           | Target Value | Mapping Status  | Notes |
| ----------------------------------- | ----------------- | ------------ | --------------- | ----- |
| SOURCE COLUMN CONFIRMATION REQUIRED | company_cv_status | `not_sent`   | REVIEW REQUIRED |       |
| SOURCE COLUMN CONFIRMATION REQUIRED | company_cv_status | `sent`       | REVIEW REQUIRED |       |
| SOURCE COLUMN CONFIRMATION REQUIRED | company_cv_status | `received`   | REVIEW REQUIRED |       |
| SOURCE COLUMN CONFIRMATION REQUIRED | company_cv_status | `overdue`    | REVIEW REQUIRED |       |
