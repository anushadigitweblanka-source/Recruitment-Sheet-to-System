# Historical interview records

The older interview log (a CSV) is kept in PostgreSQL as read-only history. This page explains where it appears and what it is allowed to do.

## What is stored

Two tables, created by migration `015_historical_interviews.sql`:

- `historical_import_batches` – one row per imported file (file name, SHA-256 fingerprint, counts, status).
- `historical_interview_records` – one row per CSV record, with every value exactly as read (name, contact number, date text, position, source, mode, original status, remarks) and any review flags. Nothing is corrected, merged or converted.

A record is **one line of an interview log, not a person**. The same person can appear more than once and the file has no Candidate IDs.

## Where it appears

| Place                                 | What it shows                                                                                                                                                                                             |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Candidate Management → Candidate List | One Recruitment Records list: the live candidates and the imported records together, with search, position/source/status filters and paging. Imported records are read-only and have a **Details** panel. |
| Employee Lifecycle → Employee List    | **Joining Verification Pending**: the imported records whose original status is exactly `Selected`, with search, filters, paging and Details.                                                             |
| Dashboard                             | Counts only: total records, historical records, current candidate profiles and the original status counts.                                                                                                |

There is no separate Historical Interviews page. The old address `/historical-interviews` redirects to the Candidate List.

All of it needs the `historical.view` permission (Main User and HR). The server refuses everyone else; the screens are hidden for them.

## What it never does

- A `Selected` record is **not** a joined employee. It is not counted in Evaluation, Probation, Junior or Senior, which come only from verified employee records.
- Nothing is created from a historical record: no candidate, Candidate ID, offer, employee, joining date, lifecycle phase, notification or email.
- Records are not merged, even when a phone number repeats.

To confirm that a selected person joined, HR checks the facts, finds or registers the matching candidate in the Candidate List, and records the offer and the verified joining date through the normal offer workflow (Attended = Yes → Joined → Evaluation).

## API (all read-only, `historical.view`)

- `GET /api/historical-interviews` – list with `search`, `status`, `position`, `source`, `mode`, `flag`, `review`, `dateFrom`, `dateTo`, `page`, `pageSize`.
- `GET /api/historical-interviews/summary` and `/options` – counts and filter values (`options` accepts `status` to limit the counts to one original status).
- `GET /api/recruitment-records` and `/options` – the Candidate List query over live candidates and historical records (also needs `candidates.view`).

## Importing

The importer is a guarded command-line script, not a screen:

```
npm run import:historical -- "<file.csv>"                       dry run (default)
npm run import:historical -- "<file.csv>" --execute --confirm-sha <fingerprint> --backup "<dump>"
npm run import:historical -- --rollback <batchId>
```

It refuses without the file fingerprint, a recent non-empty backup file and a development database, writes only the two historical tables, and refuses to load the same file twice. Real CSV files and backups are never committed to the repository.
