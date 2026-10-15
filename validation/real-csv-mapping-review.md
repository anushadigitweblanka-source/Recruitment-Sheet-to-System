# Real CSV Mapping Review — aggregate only (2026-10-15)

**PII-safe.** This report contains counts and category labels only. It holds no candidate names, phone numbers, remarks or CV links. The CSV is outside the repository and was read in place and never modified. No database connection was made.

## File and parser notes

| Item                             | Value                                                        |
| -------------------------------- | ------------------------------------------------------------ |
| File                             | `Recruitment_Updates_DigitWebLanka (3)(7.csv` (outside repo) |
| Size / fingerprint               | 74,234 bytes / SHA-256 prefix `1491c7ff37a3d5e6`             |
| Encoding                         | Windows-1252 (not valid UTF-8, no BOM)                       |
| Line endings                     | CRLF (1,262 lines)                                           |
| Quoted multi-line cells          | 6 (naive line splitting breaks records)                      |
| Columns                          | 26 (8 named, 18 unnamed); every row is 26 wide               |
| Data rows                        | 1,261                                                        |
| Non-empty records                | 404                                                          |
| Completely empty rows            | 857                                                          |
| Blank rows inside the data range | 34; records are not contiguous                               |
| Duplicate header names           | 0                                                            |

## Missing values (of 404 records)

| Column    | Missing | Share |
| --------- | ------- | ----- |
| Date      | 11      | 2.7%  |
| Source    | 8       | 2.0%  |
| Name      | 1       | 0.2%  |
| Contact # | 1       | 0.2%  |
| Mode      | 1       | 0.2%  |
| Position  | 2       | 0.5%  |
| Status    | 23      | 5.7%  |
| Remarks   | 162     | 40.1% |

## Phone (Contact #), aggregate

| Measure                                             | Count |
| --------------------------------------------------- | ----- |
| Present                                             | 403   |
| Missing                                             | 1     |
| Digits only (numeric-looking)                       | 402   |
| Contains a non-digit (two numbers in one cell)      | 1     |
| 9 digits                                            | 397   |
| 10 digits                                           | 0     |
| 8 digits                                            | 2     |
| 1–3 digits (placeholder-like)                       | 3     |
| Starts with `0`                                     | 3     |
| Starts with `+`                                     | 0     |
| Scientific notation                                 | 0     |
| Fails the database format rule (`^\+?[0-9]{9,15}$`) | 6     |

The 9-digit majority suggests the leading `0` was lost when the sheet stored phones as numbers. No value was altered.

## Duplicate risk (possible matches, not confirmed duplicates)

| Match on              | Groups | Rows involved | Largest group |
| --------------------- | ------ | ------------- | ------------- |
| Exact repeated record | 0      | 0             | n/a           |
| Normalized phone      | 26     | 53            | 3             |
| Name                  | 21     | 43            | 3             |
| Name + position       | 14     | 29            | 3             |
| Name + phone          | 21     | 43            | 3             |

Nothing was merged. Whether repeated people are duplicates or separate events (re-interviews) is undecided.

## Mapping coverage (8 named columns)

| Status                      | Columns                                       |
| --------------------------- | --------------------------------------------- |
| CONFIRMED (target only)     | Name, Contact # (value rules still pending)   |
| PENDING_MENTOR_CONFIRMATION | Date, Source, Position, Mode, Status, Remarks |
| NOT IMPORTED                | 18 unnamed columns                            |

Unresolved business values: Source 40 distinct, Position 24 distinct, Status 6 distinct (+ blank), Mode 2 distinct (+ blank). None is mentor-approved.

## Unresolved required fields

- `candidates.candidate_code` has no source in the CSV (required, unique).
- `applied_on` does not exist in the schema, so the Date meaning has no home.

## Other findings

- 6 Date values have a malformed or out-of-range year.
- 4 Name values contain digits.
- 0 email-like values anywhere in the named columns.
- 10 cells in one unnamed column (column 10) are non-empty and of unknown meaning.
- The existing importer is XLSX-only; this CSV is not compatible as-is.
