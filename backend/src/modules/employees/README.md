# Module 5 – Employee Lifecycle (backend)

**Implemented:** the employee record, the four phases (evaluation, probation, junior, senior), gate decisions, probation extensions, discontinuation, termination and the history of every phase.

| Route                                 | Permission         | Purpose                                                 |
| ------------------------------------- | ------------------ | ------------------------------------------------------- |
| `GET /api/employees`                  | `candidates.view`  | Employees, with search, filters and paging              |
| `GET /api/employees/:id`              | `candidates.view`  | One employee, their phases, and what can be decided now |
| `PATCH /api/employees/:id`            | `employees.manage` | Set the track (Intern or Staff); nothing else           |
| `POST /api/employees/:id/decision`    | `employees.manage` | The gate decision on the current phase                  |
| `POST /api/employees/:id/termination` | `employees.manage` | End the employment (Terminated)                         |

List filters: `search` (name or Candidate ID), `phase`, `track` (`intern`, `staff`, or `none` for not set), `status` (`active`, `discontinued`, `terminated`, or `exited` for both), `reviewFrom` / `reviewTo` (next review date), `page`, `pageSize` (at most 100).

Files: `employees.routes.js` (HTTP), `employees.service.js` (rules), `employees.validation.js` (field checks), `employees.repository.js` (SQL), `lifecycleDates.js` (the date calculations).

Tables: `employees`, `phase_history` and `settings` (migration 006).

Screens (`frontend/src/modules/employees/`): Employee List, the Evaluation, Probation, Junior Stage, Senior Stage and Discontinued / Exit pages, Employee Details (with the decision and termination forms), Lifecycle Timeline and Edit Employee.

## How a candidate becomes an employee

"Attended = Yes creates the employee and the 7-day evaluation" (task guide, sections 3 and 7, and the acceptance checklist). So the employee is created **automatically**, by the offer module, in the same transaction that saves the offer with Attended = Yes:

- Join date = the offer's onboarding date.
- The first phase row is the 7-day evaluation.
- A candidate has at most one employee record (unique `candidate_id`); saving the offer again never adds a second.
- Once the employee exists, the offer's status, onboarding date and attendance can no longer be changed, because the lifecycle dates start from them. Its other fields can still be corrected.

There is no route to create an employee by hand.

## Phases and dates

From the task guide, section 3. The lengths come from `settings` (editable values, not hard-coded).

| Phase      | Starts                   | Ends                                         | Gate decision               |
| ---------- | ------------------------ | -------------------------------------------- | --------------------------- |
| Evaluation | join date                | join date + 6 days (`evaluation_days` = 7)   | Pass or Discontinue         |
| Probation  | the day after evaluation | EDATE(start, 3) − 1 day (`probation_months`) | Pass, Extend or Discontinue |
| Junior     | the day after probation  | **not calculated** (see below)               | Pass or Discontinue         |
| Senior     | the day after junior     | no end date                                  | none                        |

The guide's worked example (joins 2 Nov 2026: evaluation 2–8 Nov 2026, probation 9 Nov 2026 – 8 Feb 2027, junior from 9 Feb 2027) is reproduced by the tests.

- **Pass** closes the current phase and creates the next phase row, with its dates, in the same transaction, and updates the employee's current phase.
- **Extend** (probation only) adds a new probation row from the day after the current end. The total extension may not go beyond `probation_max_extension_months` (1) after the original probation end.
- **Discontinue** needs a reason and an exit date. The employee becomes Discontinued and keeps the phase they left from.
- **Terminate** is separate from Discontinue. It needs a reason and a date, records who entered it, and is only offered once probation has passed (junior or senior).
- **Junior end date:** not calculated. HR enters it when recording the junior Pass; senior starts the next day.
- A decision needs a review document link only if HR has one; it is optional.

History is never overwritten: a decision only fills in the result of the open row, and every later phase is a new row. The database allows one open phase per employee.

Audit actions: `EMPLOYEE_CREATE`, `PHASE_START` (every new phase row), `PHASE_COMPLETE` (pass), `PHASE_EXTEND`, `EMPLOYEE_DISCONTINUE`, `EMPLOYEE_TERMINATE`, `EMPLOYEE_UPDATE` (track).

The candidate's pipeline stage stays at **Joined**; the phases after joining are read from `employees`, as the schema proposal describes, so the same fact is not stored twice.

## Not part of this module

- No reminders or emails before a phase ends (Module 6).
- No company email account records (`company_accounts`).
- No salary.
- No screen to edit the settings yet; the values are changed in the database.

## MENTOR CONFIRMATION REQUIRED

None of the items below has been approved. Each says what the application does today.

1. **Junior period (decision 5).** Nine months after probation, or nine months from the join date? The end date is not calculated; HR enters it with the junior decision. `junior_months` = 9 is stored but unused.
2. **Discontinued vs Terminated (decision 4).** Working definitions from the guide: Discontinued = left during evaluation or probation; Terminated = ended by the company after probation passed. Today Discontinue is a gate decision, and Terminate is offered only in junior and senior.
3. **Junior "Discontinue".** The guide's gate table allows Pass or Discontinue for junior, but its definition puts Discontinued in evaluation and probation only. Both Discontinue (junior gate) and Terminate are possible for a junior today.
4. **Track.** The guide lists Intern / Staff but not where it comes from. It starts empty and HR sets it. Whether track changes any phase length is not stated; today it does not.
5. **Extension limit.** "Extend (max 1 month)" is applied as a total of one month after the original probation end, across one or more extension rows.
6. **Decision timing.** The guide does not say whether a Pass may be recorded before the phase's end date. It is allowed today; the next phase still starts the day after the planned end.
7. **Terminated "approved by".** The terminated report shows "approved by". Today this records the user who entered the termination.
8. **Review links.** The workbook has 7th-day, 1-month, 3-month and 6-month review links. One optional link is stored per decision; where the 1-month and 6-month links belong is open.
9. **Existing staff without a candidate record (decision 11).** Not handled yet; every employee comes from a candidate.
