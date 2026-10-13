# Feature modules

One folder per module. **Nothing is implemented yet:** each folder holds only a README describing what will go there. No routes, services, queries or database tables exist.

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
