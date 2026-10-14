# Feature modules

Implemented:

- `auth/` — sign-in, sign-out, sessions and password hashing.
- `audit/` — writes the audit log.
- `lookups/` — the closed lists used by dropdowns (positions, sources, pipeline stages).
- `candidates/` — Module 1, Candidate Management.
- `pipeline/` — the one place that moves a candidate between stages.
- `phone-screens/` — Module 2, Phone Interview.
- `interviews/` — Module 3, Direct Interview.
- `offers/` — Module 4, Offer Management: offers, offer status, joining date, attendance and the stage changes they cause. Salary is not implemented and email status is not stored; both wait for later decisions and modules.
- `employees/` — Module 5, Employee Lifecycle: the employee record created when an offer is marked attended, the four phases, gate decisions, extensions, discontinuation, termination and phase history. The junior end date is not calculated until its rule is confirmed.

Module 6 below is **not implemented yet:** its folder holds only a README describing what will go there. It has no routes, services, queries or database tables.

| Module                   | Backend folder   | Frontend folder                          |
| ------------------------ | ---------------- | ---------------------------------------- |
| 1 – Candidate Management | `candidates/`    | `frontend/src/modules/candidates/`       |
| 2 – Phone Interview      | `phone-screens/` | `frontend/src/modules/phone-interviews/` |
| 3 – Direct Interview     | `interviews/`    | `frontend/src/modules/interviews/`       |
| 4 – Offer Management     | `offers/`        | `frontend/src/modules/offers/`           |
| 5 – Employee Lifecycle   | `employees/`     | `frontend/src/modules/employees/`        |
| 6 – Email Notifications  | `notifications/` | `frontend/src/modules/notifications/`    |

The backend folder for module 2 is named `phone-screens` to match the `phone_screens` table in the schema proposal.

## Layout of a module, once it is built

```
modules/candidates/
  candidates.routes.js      HTTP routes, mounted in src/routes/index.js
  candidates.service.js     business rules, validation and permission checks
  candidates.repository.js  SQL queries, using the shared pool
```

Modules 2, 3, 4 and 5 also have a `*.validation.js` file for field checks.

The table design for every module is in `docs/database-schema-proposal.md`. The decisions that must be answered first are in `docs/mentor-approval-required.md`. Decisions still open for a built module are listed under "MENTOR CONFIRMATION REQUIRED" in that module's README.
