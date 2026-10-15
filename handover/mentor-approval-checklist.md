# Confirmation Checklist (2026-10-15, corrected after the task-guide review)

What still needs a person's answer. Anything the official task guide defines is **not** here: it is implemented (see `validation/stage11-mentor-blocked-readiness.md`). The answer, approver and date fields are left blank on purpose; development does not fill them.

## A. The guide says to confirm, or leaves undefined

| #   | Question                                                                               | Current behaviour                                                                                              | Options the architecture supports                                            | Answer | Approved by | Date | Implementation status |
| --- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ------ | ----------- | ---- | --------------------- |
| 1   | Junior 9 months: counted from probation end or from joining? (PENDING HR CONFIRMATION) | Junior end date typed by HR at the junior Pass                                                                 | Automatic calculation from either date; `junior_months` is already a setting |        |             |      | NOT STARTED           |
| 2   | Discontinued vs Terminated definitions (PENDING HR CONFIRMATION)                       | Working definitions applied: discontinue at any gate with reason and exit date; terminate only after probation | Keep, or adjust the rules                                                    |        |             |      | NOT STARTED           |
| 3   | Phone Interview Response values                                                        | Every value refused                                                                                            | Lookup rows                                                                  |        |             |      | NOT STARTED           |
| 4   | Direct Interview Recommendation values                                                 | Accepts nothing                                                                                                | Lookup rows                                                                  |        |             |      | NOT STARTED           |
| 5   | Final Offer Work Mode values                                                           | Only `office` (temporary)                                                                                      | Replace the constraint with the approved list                                |        |             |      | NOT STARTED           |
| 6   | Failed-email retry: count and interval, or manual only?                                | Logged; manual Resend                                                                                          | Retry job with an interval and maximum                                       |        |             |      | NOT STARTED           |
| 7   | Official Candidate ID format and who generates new IDs                                 | Typed, unique, format-free                                                                                     | Keep typed, or generate with a format                                        |        |             |      | NOT STARTED           |
| 8   | Interview decision after an offer exists: locked? correction path?                     | Locked; offer never auto-deleted                                                                               | Keep, or add a correction path                                               |        |             |      | NOT STARTED           |
| 9   | Is Applied Position required before Selected?                                          | Not required; no automatic offer without a position                                                            | Require it before Selected                                                   |        |             |      | NOT STARTED           |
| 10  | Weekly report recipients: HR + management, or the Main User?                           | `weekly_report_recipients` setting, empty until set                                                            | Any list of addresses                                                        |        |             |      | NOT STARTED           |
| 11  | Where are uploaded Company CVs stored in production?                                   | Development-only local folder                                                                                  | Drive, server folder or cloud storage behind the same adapter                |        |             |      | NOT STARTED           |
| 12  | Offer Rejected: a stage?                                                               | Offer is Sent / Accepted / empty                                                                               | Add a stage and offer status                                                 |        |             |      | NOT STARTED           |
| 13  | Duplicate-candidate matching triggers                                                  | Warn on same phone, email, or name + position                                                                  | Keep or change                                                               |        |             |      | NOT STARTED           |

## B. Implementation choices made where the guide is silent (please accept or change)

| #   | Choice                                                                                            | Why it was needed                                          | Answer | Approved by | Date |
| --- | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ------ | ----------- | ---- |
| B1  | HR does not manage offers or the employee lifecycle                                               | The guide lists HR's actions without them                  |        |             |      |
| B2  | Intern / Dev holds operating permissions but no salary and no administration                      | "Test data only; build and test"                           |        |             |      |
| B3  | Joining reminder time = start of the joining day (Asia/Colombo)                                   | The guide gives a date only                                |        |             |      |
| B4  | Interview and joining reminders for a time already past are not created                           | Nothing useful to remind about                             |        |             |      |
| B5  | Scheduled reminders are protected against duplicates per reminder, not per candidate and template | The phase-end template is legitimately sent once per phase |        |             |      |
| B6  | CV reminder template type `cv_pending_reminder`                                                   | The guide names the reminder but no template               |        |             |      |
| B7  | A reminder with no possible recipient is kept as a failed row with the reason                     | So it is visible rather than lost                          |        |             |      |
| B8  | Team Lead scope follows the Team Lead row linked to the login                                     | The guide: "own team's candidates"                         |        |             |      |

## C. Future / go-live (not required for the current internship scope)

| #   | Question                                                                  | Answer | Approved by | Date |
| --- | ------------------------------------------------------------------------- | ------ | ----------- | ---- |
| C1  | Real-data import approvals — see `handover/real-csv-mapping-decisions.md` |        |             |      |
| C2  | Mail provider and credentials policy                                      |        |             |      |
