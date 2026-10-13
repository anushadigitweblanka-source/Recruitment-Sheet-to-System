# Feature modules

Implemented:

- `auth/` — sign-in, sign-out, sessions and password hashing.
- `audit/` — writes the audit log.
- `lookups/` — the closed lists used by dropdowns (positions, sources, pipeline stages).
- `candidates/` — Module 1, Candidate Management.
- `pipeline/` — the one place that moves a candidate between stages.
- `phone-screens/` — Module 2, Phone Interview.

Modules 3 to 6 below are **not implemented yet:** each folder holds only a README describing what will go there. They have no routes, services, queries or database tables.

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

The table design for every module is in `docs/database-schema-proposal.md`. The decisions that must be answered first are in `docs/mentor-approval-required.md`.
