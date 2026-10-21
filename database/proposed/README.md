# Proposed migrations (not applied)

Files here are **design specifications**. The migration runner reads only `database/migrations`, so nothing in this folder is ever applied by `npm run db:migrate`.

A file moves into `database/migrations` (with the next number) only after the project owner approves it **and** the target database.

| File                            | Purpose                                                                               | Status                      |
| ------------------------------- | ------------------------------------------------------------------------------------- | --------------------------- |
| `015_historical_interviews.sql` | Tables for the imported historical interview log and the `historical.view` permission | Proposed, awaiting approval |

Automated tests load this file into their own throwaway schema to exercise the importer and the Historical Interviews page with fictional records.
