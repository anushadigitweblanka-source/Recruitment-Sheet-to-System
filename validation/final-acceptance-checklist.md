# Final Acceptance Checklist (Stage 14, 2026-10-15)

The official _Recruitment Sheet to System – Intern Task Guide_ is the source of truth. This checklist records, for each requirement, what is actually true today. It replaces the earlier version of this file.

**No formal approval is recorded in this repository.** Nothing in this file is a signature, and no item is marked as accepted by a person.

## Basis of the scope and of the decisions recorded here

| Statement                                                   | Basis                                                                                                        |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| The internship is scoped to dummy / test data only          | **Reported** by the project owner as the mentor's instruction. No written mentor record is in the repository |
| The Junior phase counts 9 months from the day junior starts | **Project-owner implementation decision.** Not an HR sign-off; HR confirmation is still pending              |
| Any training, demo review or acceptance                     | **No record exists.** None is claimed                                                                        |
| Any approval or signature                                   | **None exists.** The forms are blank                                                                         |

## Status key

| Status      | Meaning                                                                                                                                                                       |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **PASS**    | Built and covered by automated tests with fictional data, and where possible checked in the running development application. Nothing is outstanding for the dummy-data scope. |
| **PARTIAL** | Built and tested, but one part waits on something outside the software: a real provider, real data, HR confirmation or a person.                                              |
| **PENDING** | Not done. It needs real data, a company system, a decision or a human action that has not happened.                                                                           |

"Live" means the running development application and database with fictional data. Nothing was run against production, real recruitment data or a real mailbox.

## A. The guide's acceptance checklist (section 8)

| #   | Requirement                                                                           | Status      | Evidence / what is outstanding                                                                                                               |
| --- | ------------------------------------------------------------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | All 2,463 candidates imported; row counts match the Excel per tab                     | **PENDING** | No import has happened. The reviewed CSV is the Interview Schedules tab (404 records), not the master list                                   |
| 2   | No duplicate candidate_id; no #REF! errors                                            | **PARTIAL** | Unique candidate ID and duplicate warnings are enforced and tested; real data not yet loaded                                                 |
| 3   | Selecting "Selected" in the interview creates an offer row automatically              | **PASS**    | `offerAutoCreate`, `prepareOffer` tests; offers exist for the dev candidates                                                                 |
| 4   | Interview total /50 calculates automatically                                          | **PASS**    | Database-generated column; interview tests                                                                                                   |
| 5   | Onboarding Date and "Attended" create the employee and the 7-day evaluation           | **PASS**    | Employee and lifecycle tests; live in dev                                                                                                    |
| 6   | Evaluation Pass → Probation; Probation Pass → Junior (9 months); Junior Pass → Senior | **PASS**    | Lifecycle tests. The Junior end uses `junior_months` from the junior start: the project owner's decision, HR confirmation pending            |
| 7   | Dates match the worked example in section 3                                           | **PASS**    | An automated test reproduces 2 Nov 2026 → junior 9 Feb to 8 Nov 2027, Senior from 9 Nov 2027                                                 |
| 8   | Reminder arrives 24 hours before evaluation end and probation end, once only          | **PARTIAL** | Timing, once-only and duplicate prevention tested. **No real email has been delivered** (development adapter)                                |
| 9   | Extension or date change replaces the old reminder                                    | **PASS**    | `stage11Notifications` tests                                                                                                                 |
| 10  | Dashboard shows counts per phase and deadlines in the next 7 days                     | **PASS**    | Dashboard tests; live in dev                                                                                                                 |
| 11  | User guide written and HR trained                                                     | **PARTIAL** | User guide and HR training guide are complete. **No training has taken place on record**: `handover/hr-training-sign-off-record.md` is blank |

### Added for emails and reports

| #   | Requirement                                                                                        | Status      | Evidence / what is outstanding                                                                                                |
| --- | -------------------------------------------------------------------------------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------- |
| 12  | Phone interview Selected sends the invitation and the Team Lead details, with calendar invite      | **PARTIAL** | Both mails and the `.ics` attachment are built and tested. Never opened in a real mailbox or calendar client                  |
| 13  | Direct interview Selected sends the joining mail to the candidate with HR and Team Lead in CC      | **PARTIAL** | Built, with the Main User approval step. Development adapter only                                                             |
| 14  | Interview and joining reminders go out 24 hours before, once only                                  | **PARTIAL** | Tested; not delivered for real                                                                                                |
| 15  | `email_log` records every mail; "Mail Sent" updates by itself                                      | **PASS**    | Notification and approval tests                                                                                               |
| 16  | Reports exist for Selected, Rejected, On Hold, Joined, Currently Working, Discontinued, Terminated | **PASS**    | Reports and exports tests; live in dev                                                                                        |
| 17  | Weekly recruitment summary matches manual counts from the Excel for 2 sample weeks                 | **PENDING** | Needs the real workbook and manual counts                                                                                     |
| 18  | Every report exports to Excel and PDF; weekly mail arrives Monday 08:00                            | **PARTIAL** | Exports PASS (Excel, CSV, PDF). The Monday mail is scheduled and tested but never delivered; recipients are empty in Settings |

### Added for the Company CV and company email account

| #   | Requirement                                       | Status      | Evidence / what is outstanding                                         |
| --- | ------------------------------------------------- | ----------- | ---------------------------------------------------------------------- |
| 19  | CV link stored automatically after upload         | **PARTIAL** | Works against development file storage; no production storage provider |
| 20  | Account requested at joining and disabled at exit | **PASS**    | `stage11CompanyAccounts` tests                                         |

## B. Other guide requirements

| Requirement (guide section)                                                               | Status      | Evidence / what is outstanding                                                                                                 |
| ----------------------------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Roles Main User / HR / Team Lead / Intern-Dev; Team Lead sees own team (7)                | **PASS**    | `stage11Roles` tests                                                                                                           |
| HR enters the Offer Tracker step (7)                                                      | **PARTIAL** | HR currently lacks `offers.manage`, so HR can open Prepare Offer but not save. Needs your approval to change                   |
| Salary in its own table, Main User only, every view and change logged (7)                 | **PASS**    | Salary, Offer List and report tests; absent from reports, exports, mail and logs for other roles                               |
| Salary & Offer report, Main User only (9)                                                 | **PASS**    | `salaryOfferReport` tests; every view and export audited                                                                       |
| Seven mail types, editable templates, preview, Auto or one-click, Resend logged (5, 8)    | **PARTIAL** | Built and tested. No template is seeded; no mail provider is configured                                                        |
| WhatsApp / SMS text with the same details (8)                                             | **PASS**    | Preview and Copy Message on the candidate page; nothing is sent by the system                                                  |
| 24-hour email **and in-app alert** (4)                                                    | **PASS**    | Notification bell, migration 014, `inAppAlerts` tests. Shown to users whose login email is a recipient                         |
| Company CV template, personal upload link, statuses, "CV pending" (11)                    | **PARTIAL** | As row 19                                                                                                                      |
| Temporary password encrypted, masked, 30-second reveal, logged, deleted after change (11) | **PASS**    | `stage11CompanyAccounts` tests                                                                                                 |
| Every status change stores who and when (8)                                               | **PASS**    | Stage history and append-only audit log                                                                                        |
| Closed lists as dropdowns (8)                                                             | **PARTIAL** | Stage, position, source, decision are lists. Phone `response`, interview `recommendation` and work-mode lists await the mentor |
| Phone numbers as text; dates as real dates (8)                                            | **PASS**    | Validation tests                                                                                                               |
| Never edit the original workbook (8)                                                      | **PASS**    | The real CSV was only read; it is outside the repository                                                                       |
| Candidate data restricted to HR and managers (8)                                          | **PASS**    | Backend permissions on every module; 401/403 tests                                                                             |
| Clean and import past interviews, matched by phone then name (10)                         | **PENDING** | Read-only CSV and workbook dry run exists; no importer, no approved mappings                                                   |
| Current staff import, `source = Historical`, "Decision missing" (10)                      | **PENDING** | Not built; needs an approved schema change                                                                                     |
| Status mapping "Not Accepted by Candidate" → Offer Rejected (10)                          | **PENDING** | "Offer Rejected" is not a stage; needs a decision                                                                              |
| Import report signed by HR before the old Excel is frozen (10)                            | **PENDING** | No import has happened                                                                                                         |

## C. Task-plan deliverables (guide section 7)

| Deliverable                                                             | Status      | Where                                                              |
| ----------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------ |
| Process map and data dictionary                                         | **PASS**    | `data-maps/`, `docs/`, `documentation/`                            |
| Approved schema and screen sketches                                     | **PASS**    | `docs/database-schema-proposal.md`, migrations 001–014             |
| Import script and list of rows needing review                           | **PARTIAL** | Dry-run tool and review report exist; the importer itself does not |
| Working recruitment flow with test data                                 | **PASS**    | `validation/final-dummy-acceptance.md`; automated tests            |
| Onboarding to Senior tracking working                                   | **PASS**    | Employee lifecycle module                                          |
| Proof that mails and reminders go at the right time; all reports export | **PARTIAL** | Timing proven by tests; no real delivery                           |
| Demo, user guide and final sign-off                                     | **PARTIAL** | User guide done. No demo record and no sign-off                    |

## D. Test and quality evidence

| Check                     | Result                                                                                       |
| ------------------------- | -------------------------------------------------------------------------------------------- |
| Backend tests             | 621 / 621 pass                                                                               |
| Frontend tests            | 404 / 404 pass                                                                               |
| **Total**                 | **1,025 / 1,025**                                                                            |
| Build, lint, format check | All pass                                                                                     |
| Migrations                | 001–014, applied to the development database only                                            |
| Live development checks   | Offer, report, export, bell and message endpoints answered correctly against the running app |

## E. Acceptance dependencies (not implemented by this task)

| Dependency                                                    | Type              | Owner                  |
| ------------------------------------------------------------- | ----------------- | ---------------------- |
| Real data import and count reconciliation                     | Data and approval | Mentor, HR             |
| Master workbook, approved mappings, import authorization      | Data and approval | Mentor, HR             |
| Real email delivery (provider, mailbox, templates, addresses) | External setup    | Company IT, Main User  |
| Production database, hosting, storage, backups, TLS           | External setup    | Company IT             |
| Business decisions (see `handover/mentor-decision-list.md`)   | Decision          | Mentor, HR             |
| HR confirmation of the Junior reading                         | Confirmation      | HR                     |
| HR offer permission                                           | Approval          | Project owner          |
| HR training session and its record                            | Human action      | HR, trainer            |
| Final sign-off                                                | Human approval    | Mentor, HR, management |

## F. Overall

| Question                                                  | Answer  |
| --------------------------------------------------------- | ------- |
| Software implementation complete for the dummy-data scope | **YES** |
| Historical import complete                                | **NO**  |
| Real email delivery verified                              | **NO**  |
| Production ready                                          | **NO**  |
| HR training delivered on record                           | **NO**  |
| Formal sign-off obtained                                  | **NO**  |

Sign-off is made on `handover/final-sign-off-form.md`.
