# Final Acceptance Checklist (2026-10-15)

Status of every official task-guide acceptance item, plus the delivery items of this handover.

**Scope (mentor-approved):** the current internship task uses **dummy/test data only**. The completion basis is therefore: fictional/dummy data, the automated test suite, manual development verification, the mentor/HR demo, the remaining mentor decisions, and the final sign-off. Real-data items stay documented below for completeness, but they are **not required for the current internship completion**.

Verdicts: **PASS** (verified working, fictional data), **BLOCKED** (waits on a named mentor decision), **DEFERRED — OUT OF CURRENT INTERNSHIP SCOPE BY MENTOR INSTRUCTION** (real-data / go-live work, kept documented, not a failure), **NOT TESTED**.

Evidence: the automated suite (record final totals in the cleanup review), the dummy-data acceptance run of 2026-10-14 (`final-dummy-acceptance.md`, 66 checks) and the per-feature validation reports in this folder. Items marked BLOCKED remain unresolved business rules; Stage 11 implementation requirements marked PASS are implemented and tested. No real-data item is marked PASS.

## Authentication & access

| Item                                                                                      | Verdict | Evidence / blocker                                                                                                                                     |
| ----------------------------------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Login/logout, session handling, 401 on protected routes, no back-button replay            | PASS    | final-dummy-acceptance.md                                                                                                                              |
| Backend-enforced permissions (401/403) on every module                                    | PASS    | module tests; validation reports                                                                                                                       |
| User administration (create, deactivate, reactivate, reset password; Argon2id; no delete) | PASS    | users-admin-validation.md                                                                                                                              |
| Final role list (HR / Team Lead / Intern) and their permissions                           | PASS    | IMPLEMENTED_FROM_TASK_GUIDE: migration 009, stage11Roles.test.js. Editing roles in the app: not requested by the guide; the roles view stays read-only |

## Candidate management

| Item                                                                                                                                                      | Verdict | Evidence / blocker                                     |
| --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ------------------------------------------------------ |
| Add/edit/view/search candidates; starts at Applied; stage history                                                                                         | PASS    | final-dummy-acceptance.md                              |
| **Duplicate handling**: unique Candidate ID refused; phone/email/name+position duplicates warn with matches, saved only on explicit confirm, never merged | PASS    | final-dummy-acceptance.md                              |
| Candidate ID format / auto-generation                                                                                                                     | BLOCKED | mentor decision 11 (typed, unique, format unconfirmed) |
| CV file upload                                                                                                                                            | BLOCKED | storage location unapproved; CV link fields exist      |

## Phone interview

| Item                                                                                          | Verdict | Evidence / blocker                                      |
| --------------------------------------------------------------------------------------------- | ------- | ------------------------------------------------------- |
| Record call/result; Selected+date → Interview Scheduled; Not Selected needs reason → Rejected | PASS    | final-dummy-acceptance.md                               |
| `response` field values                                                                       | BLOCKED | mentor decision 6 (field refuses all values, by design) |

## Direct interview

| Item                                                                         | Verdict | Evidence / blocker                                    |
| ---------------------------------------------------------------------------- | ------- | ----------------------------------------------------- |
| Requires Interview Scheduled; five 0–10 scores, all-or-none                  | PASS    | final-dummy-acceptance.md                             |
| **Interview total /50 auto-calculated** (database-computed, cannot be typed) | PASS    | final-dummy-acceptance.md; schema `GENERATED ALWAYS`  |
| Selected / Not Selected / On Hold stage moves with required reasons          | PASS    | final-dummy-acceptance.md                             |
| `recommendation` value list                                                  | BLOCKED | mentor decision (no approved list; no value accepted) |

## Offers

| Item                                                                                                                  | Verdict | Evidence / blocker                                                                                         |
| --------------------------------------------------------------------------------------------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------- |
| **Automatic offer creation on Selected** — exactly one, same transaction, applied position, nothing invented, audited | PASS    | offer-auto-create-validation.md (7 tests + live run)                                                       |
| Offer statuses Sent/Accepted move the stage; joining date; one offer per candidate                                    | PASS    | final-dummy-acceptance.md                                                                                  |
| Auto-offer when the candidate has no applied position                                                                 | BLOCKED | cannot exist without inventing a position; candidate waits for a manual offer — mentor to confirm the rule |
| Work-mode value list                                                                                                  | BLOCKED | only `office` approved (temporary, migration 007)                                                          |
| "Offer Rejected" as a stage                                                                                           | BLOCKED | mentor decision 3                                                                                          |
| Salary (storage, visibility, access logging)                                                                          | PASS    | Implemented in Stage 11; see `stage11Salary.test.js`                                                       |

## Employee lifecycle

| Item                                                                                                                                                     | Verdict | Evidence / blocker                                                                              |
| -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ----------------------------------------------------------------------------------------------- |
| **Attended = Yes creates the employee automatically** + 7-day evaluation, once only                                                                      | PASS    | final-dummy-acceptance.md; employees tests                                                      |
| **Lifecycle transitions**: Evaluation→Probation→Junior→Senior via Pass; dates per the guide's worked example; probation extension capped; one open phase | PASS    | final-dummy-acceptance.md; lifecycle tests                                                      |
| Discontinue (reason + exit date) and Terminate (post-probation, reason + date)                                                                           | PASS    | final-dummy-acceptance.md                                                                       |
| Discontinued vs Terminated definitions                                                                                                                   | BLOCKED | STILL_REQUIRES_CONFIRMATION — PENDING HR CONFIRMATION (built to the guide's working definition) |
| Junior end-date calculation (9-month rule basis)                                                                                                         | BLOCKED | STILL_REQUIRES_CONFIRMATION — PENDING HR CONFIRMATION; HR enters the date at the junior Pass    |

## Notifications (Module 6)

| Item                                                                                                                                                          | Verdict                                                          | Evidence / blocker                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| **Reminder machinery**: schedule, send_at = due − 24h, 15-min job, DB-enforced duplicate prevention, failure isolation, explicit resend, email log, templates | PASS                                                             | 2026-10-14-module6-email-notifications.md                                                                                     |
| **Automatic reminder creation** (who gets what)                                                                                                               | PASS                                                             | IMPLEMENTED_FROM_TASK_GUIDE: stage11Notifications.test.js (phase, interview, joining, CV pending; replacement on date change) |
| Template types and send modes (Auto / One-click), one-off mails with preview, edit and Resend, CV pending reminder                                            | PASS                                                             | IMPLEMENTED_FROM_TASK_GUIDE: stage11Notifications.test.js, stage11CompanyCv.test.js                                           |
| Failed-email automatic retry count and interval                                                                                                               | BLOCKED                                                          | STILL_REQUIRES_CONFIRMATION — failures logged, manual Resend                                                                  |
| Real email delivery                                                                                                                                           | DEFERRED — out of current internship scope by mentor instruction | go-live work: no approved provider; development adapter only                                                                  |

## Dashboard, reports, exports

| Item                                                                                               | Verdict | Evidence / blocker                                                                                                                                      |
| -------------------------------------------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Dashboard** — live DB counts (stages, employees, phases, upcoming interviews), nothing hardcoded | PASS    | dashboard-validation.md                                                                                                                                 |
| **Reports** — all seven, live-queried, filtered, Colombo calendar                                  | PASS    | reports-validation.md                                                                                                                                   |
| **Exports** — Excel/CSV/PDF for every report, matching the filtered screen                         | PASS    | report-exports-validation.md                                                                                                                            |
| **Weekly email** (Monday 08:00 Asia/Colombo, previous week, once per week)                         | PASS    | IMPLEMENTED_FROM_TASK_GUIDE: stage11Notifications.test.js. Recipients are a setting because the guide names two audiences (STILL_REQUIRES_CONFIRMATION) |
| Weekly "applications" uses true application date                                                   | BLOCKED | needs approved `applied_on` migration; uses created-date meanwhile (documented)                                                                         |

## Stage 11 — salary, Company CV, company accounts

| Item                                                                                                                                | Verdict | Evidence / blocker                                                               |
| ----------------------------------------------------------------------------------------------------------------------------------- | ------- | -------------------------------------------------------------------------------- |
| Salary: `offer_salary`, Main User only, every view and change audited, absent from reports, exports, mail and logs                  | PASS    | IMPLEMENTED_FROM_TASK_GUIDE: stage11Salary.test.js                               |
| Company CV: template in Settings, candidate upload link, Received / Overdue, 24h reminder, CV pending, link on the interview screen | PASS    | IMPLEMENTED_FROM_TASK_GUIDE: stage11CompanyCv.test.js (development storage only) |
| Company account lifecycle: Requested → Created → Handed over → Disabled, shown on the employee profile                              | PASS    | IMPLEMENTED_FROM_TASK_GUIDE: stage11CompanyAccounts.test.js                      |
| Temporary password: encrypted, masked, Main User only, re-login, 30 seconds, logged, deleted after change                           | PASS    | IMPLEMENTED_FROM_TASK_GUIDE: stage11CompanyAccounts.test.js                      |
| Production CV storage provider                                                                                                      | BLOCKED | STILL_REQUIRES_CONFIRMATION — the guide names no provider                        |
| Main User approves offer mails (HR prepares, Main User approves or rejects; audited; backend-enforced)                              | PASS    | IMPLEMENTED_FROM_TASK_GUIDE: stage11Approval.test.js                             |
| Auto-send / Review-then-send per mail type                                                                                          | PASS    | IMPLEMENTED_FROM_TASK_GUIDE: stage11Approval.test.js                             |

## Settings & audit

| Item                                                      | Verdict | Evidence / blocker                 |
| --------------------------------------------------------- | ------- | ---------------------------------- |
| Editable phase durations, audited, applied at next gate   | PASS    | admin-settings-audit-validation.md |
| Append-only audit log viewer; secrets refused in payloads | PASS    | admin-settings-audit-validation.md |

## Data

| Item                                               | Verdict                                                          | Evidence / blocker                                                                                                                          |
| -------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| **Real data import** (the company workbook)        | DEFERRED — out of current internship scope by mentor instruction | not required for internship completion; dry-run framework PASS on fictional workbooks (import-dry-run/); readiness gate kept for the future |
| Approved positions/sources/status mappings entered | DEFERRED — out of current internship scope by mentor instruction | arrive with the future import plan                                                                                                          |
| Candidates 2002/2003 protected and unmodified      | PASS                                                             | verified before/after every validation run                                                                                                  |

## Handover deliverables

| Item                                                             | Verdict    | Evidence / blocker                                                                                                                                                                                                                |
| ---------------------------------------------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **User guide**                                                   | PASS       | documentation/user-guide.md (this pack)                                                                                                                                                                                           |
| **HR training guide**                                            | PASS       | documentation/hr-training-guide.md (this pack)                                                                                                                                                                                    |
| Final handover checklist                                         | PASS       | handover/final-handover-checklist.md (this pack)                                                                                                                                                                                  |
| Mentor decision list consolidated                                | PASS       | handover/mentor-decision-list.md (this pack)                                                                                                                                                                                      |
| **Final sign-off** (mentor + HR acceptance of the current scope) | NOT TESTED | based on the dummy-data demo, the automated test results, the completed user guide and HR training material, the remaining mentor decisions resolved or formally deferred, and mentor/HR approval — **real data is not required** |

## Summary

Stage 11 implementation is complete and its requirements are marked PASS where implemented and tested with fictional data. BLOCKED items elsewhere in this checklist identify unresolved business rules and their safe current behavior; they do not mean Stage 11 implementation is mentor-blocked. DEFERRED items are real-data/go-live work and are outside the current dummy-data scope. Final project sign-off remains a separate review item. No item was marked PASS on guesswork.
