# Mentor Approval Required

Eleven decisions are open before the database can be built. **Only one of them (number 7, the login method) blocks the first migration.** Seven more block a specific feature, and three can wait.

Please fill in the "Mentor answer" column. Details behind each item are in `docs/database-schema-proposal.md`.

## Decisions

Urgency: **1** = needed before the first migration, **2** = needed before the named feature is built, **3** = can be confirmed later.

| #   | Decision                                                                                                                                                                                     | Why needed                                                                                                                    | Recommended option                                                                                                                          | Mentor answer | Blocks what?                                                |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | ----------------------------------------------------------- |
| 7   | **Login method and role list.** Email and password, or company Google sign-in? Is "manager" the team lead? Does IT get a login?                                                              | Almost every table records who created or changed a row, so `users` must exist first. Its columns depend on the login method. | Email and password. If this cannot be decided now, approve keeping sign-in details in a separate table added later, which unblocks `users`. |               | **1** — the `users` table, and through it every other table |
| 1   | **Salary storage.** Salary only in a separate `offer_salary` table, or as a column in `offers`?                                                                                              | The guide says both. The choice changes the columns of `offers`.                                                              | Only in `offer_salary` (see "Salary" below).                                                                                                |               | **2** — offers and salary tables, offer form                |
| 2   | **Salary viewing.** Only the Main user may view and edit salary, and every view is logged?                                                                                                   | Decides which role gets the salary permission. The tables are the same either way.                                            | Yes to both, as the guide states.                                                                                                           |               | **2** — offer form, salary report                           |
| 3   | **Stage list.** Is "Offer Rejected" a stage? Are the guide's twelve pre-joining stages final?                                                                                                | The stage column only accepts values from an agreed list.                                                                     | Add "Offer Rejected"; keep the other twelve.                                                                                                |               | **2** — pipeline tables, candidate list and stage dropdown  |
| 11  | **Candidate ID and existing staff.** What does the current Candidate ID look like, and how are new ones numbered? Do existing staff with no candidate record get a minimal candidate record? | A candidate cannot be saved without an ID. The staff answer decides whether an employee must link to a candidate.             | Keep the workbook's existing IDs and continue the same pattern. Give existing staff a minimal candidate record.                             |               | **2** — candidate registration; employee tables             |
| 4   | **Discontinued vs Terminated.** Discontinued = left or stopped during evaluation or probation; Terminated = ended by the company after probation passed?                                     | Decides the allowed employee statuses and which fields are required at exit.                                                  | Accept the guide's working definitions.                                                                                                     |               | **2** — employee tables, exit reports                       |
| 5   | **Junior period.** Nine months after probation ends, or nine months from the joining date?                                                                                                   | Changes the calculated end date and the acceptance test. No table changes.                                                    | Nine months after probation, matching the guide's worked example.                                                                           |               | **2** — lifecycle date calculation                          |
| 9   | **CV storage.** Where are uploaded CVs kept (Google Drive, a server folder, cloud storage)?                                                                                                  | Decides how the upload is built. The database only stores a reference.                                                        | No recommendation; depends on what the company already uses.                                                                                |               | **2** — CV upload                                           |
| 6   | **Approved lists.** Positions, sources and the position-name mapping; dropdown values for phone-screen response, interview recommendation and offer work mode.                               | These are rows in lookup tables, so development can use test values. Real values are needed for real data.                    | HR supplies the lists; a copy of the workbook's dropdowns would be enough.                                                                  |               | **3** — real data import and go-live                        |
| 8   | **Company account passwords.** Never stored, or stored encrypted for the Main user only?                                                                                                     | Decides whether an extra encrypted table exists. It can be added later without changing anything else.                        | Never store; use a temporary password with a forced change at first login.                                                                  |               | **3** — company account feature                             |
| 10  | **WhatsApp/SMS.** In scope?                                                                                                                                                                  | If yes, one column is added to the mail log.                                                                                  | Out of scope for the first version.                                                                                                         |               | **3** — nothing until the mail features are built           |

## Salary (decision 1) — MENTOR APPROVAL REQUIRED

|                    | A. `salary_lkr` in `offers`                                             | B. Salary only in `offer_salary`                           |
| ------------------ | ----------------------------------------------------------------------- | ---------------------------------------------------------- |
| Who can reach it   | Anyone whose screen or report reads offers, unless every query hides it | Only code that deliberately opens the salary table         |
| Risk of a leak     | One careless query or export exposes salaries to HR and team leads      | Offers, reports and exports contain no salary at all       |
| Logging every view | Hard: reading an offer and reading a salary look the same               | Simple: one table, one place to log                        |
| Matches the guide  | Section 2 field list                                                    | The access-control section, which is the more specific one |
| Effort             | Slightly less                                                           | One extra small table                                      |

**Recommended: B.** It is the safer design, and the guide's own confidentiality rules describe it. Not decided here.

## Notification rule (confirmed from the guide, no answer needed)

The guide uses two different times for two different purposes:

- **Due time:** the deadline itself, "end date at 17:30 (office closing, Asia/Colombo)".
- **Send time:** "that datetime minus 24 hours" (the table column reads "Send at: due - 24h").

The exact sending rule in the guide is: _"A scheduled job runs every 15 minutes, picks rows where send_at <= now and sent_at is empty, sends them, and sets sent_at."_

So a reminder is eligible when **`send_at <= now` and `sent_at` is empty**. Using the due time instead would send the reminder at the deadline, 24 hours too late.

One gap in the guide: its field list for `notifications` names `due_at` and `sent_at` but leaves out `send_at`, although the rule needs it. The schema proposal stores all three.

## Before real data can be imported

Nothing is imported until every item in the first list is done.

**Required before import**

- **Authorization:** written approval from the mentor or HR head to load real candidate data, naming where it may be held. The guide gives the intern role test data only.
- **Source workbook:** a copy of the workbook. The original is never edited.
- **Column mapping:** every column of every tab mapped to a table column, checked against the actual workbook (the proposal was written from the guide's summary, not the workbook).
- **Decisions answered:** numbers 3, 4, 6 and 11 above.
- **Position and source mapping:** the name-merge table approved by HR.
- **Candidate ID handling:** agreed rule for keeping existing IDs and for rows that have none.
- **All target tables built** and tested with dummy data.
- **Dry run:** a full trial import on a copy, producing the import report (rows imported, matched, needing review) for HR to sign off.
- **Backup and rollback plan:** a database backup immediately before the import, and a tested way to remove one import batch.
- **Mail switched off** for the import, so historical rows cannot trigger emails.
- **No real salaries:** the guide says real salary is entered by the Main user after go-live.

**Can be done during import development (with a dummy workbook)**

- Phone normalization (restore the leading zero, flag invalid numbers).
- Date normalization (convert text dates, list ambiguous ones for HR).
- Duplicate detection (same phone, email, or name plus phone) and the review list.
- Flagging CV links reused across candidates.
- Matching the older interview log to candidates by phone, then name, with unmatched rows sent to review.
- Mapping old status words to the stage list.
- The import report itself.

## Build readiness

**SAFE TO BUILD NOW** (no table, no decision needed)

- Backend and frontend structure: page layout, navigation, shared form and table components.
- The database migration tooling (how migrations are run and recorded), without any migration.
- The date calculation for phases as a tested function, with the durations as inputs.
- Phone and date normalization functions, tested with made-up values.

**WAITING FOR MENTOR**

- **First migration**, waiting on decision 7: `roles`, `permissions`, `role_permissions`, `users`, `positions`, `position_aliases`, `sources`, `settings`, `audit_log`, `candidates`.
- **Candidate registration**, waiting on decision 11.
- **Pipeline and stage dropdown**, waiting on decision 3.
- **Offers and salary**, waiting on decisions 1 and 2.
- **Employee lifecycle**, waiting on decisions 4, 5 and 11.
- **CV upload**, waiting on decision 9.

**DO NOT BUILD YET**

- Any import of real data.
- Sending real emails or connecting the company mailbox.
- Storage of company account passwords.
- WhatsApp or SMS.
- Anything that holds a real salary.
