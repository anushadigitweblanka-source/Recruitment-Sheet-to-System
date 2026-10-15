# Real CSV Source Assessment (2026-10-15)

**PII-safe.** Counts and category labels only. No name, phone number, remark or CV link appears here, and the CSV itself is outside the repository.

**Conclusion: the reviewed CSV is the older interview log (guide Tab 7, "Interview Schedules"), not the 2,463-candidate master list. It must not be treated as the complete candidate source, and nothing has been imported.**

## Evidence

| Check                     | Official guide (section 10)                                         | Reviewed CSV                                                   | Reading                                  |
| ------------------------- | ------------------------------------------------------------------- | -------------------------------------------------------------- | ---------------------------------------- |
| Rows                      | Tab 7: about 399 named rows                                         | 404 non-empty records (1,261 data rows, 857 empty)             | Same order of size; the master has 2,463 |
| Columns                   | Date, source, mode, position, status, remarks (plus name and phone) | Date, Source, Name, Contact #, Mode, Position, Status, Remarks | Same fields                              |
| Candidate ID              | "no candidate_id"                                                   | No ID column                                                   | Same                                     |
| Selected                  | 145                                                                 | 145                                                            | Equal                                    |
| Rejected                  | 89                                                                  | 89                                                             | Equal                                    |
| Not Accepted by Candidate | 23                                                                  | 23                                                             | Equal                                    |
| Rescheduled               | 18                                                                  | 18                                                             | Equal                                    |
| Not Attended              | 69                                                                  | 70                                                             | +1                                       |
| On Hold                   | 35                                                                  | 36                                                             | +1                                       |
| Blank status              | not stated                                                          | 23                                                             | Not in the guide's total                 |

Four of the six status counts are identical to the guide's Tab 7 figures and the other two differ by one row each, which is consistent with a later export of the same tab. The guide gives no CSV row count for the master; the master needs a separate source.

## What was prepared (read-only)

- **CSV reader** (`backend/src/import/csv.js`): decodes Windows-1252 without guessing (UTF-8 first, Windows-1252 only for invalid UTF-8), handles CRLF, quoted multi-line cells and doubled quotes, drops columns that are empty everywhere, and numbers records from the header.
- **Tab 7 area** in the dry-run's structure map: recognized by its headers, with no Candidate ID; matched to the master by phone, then by name, as the guide says.
- **Dry-run compatibility:** `readWorkbook` accepts a `.csv` and the existing PII-safe report is reused. The database handle refuses every write.
- **Fictional-fixture tests:** `backend/tests/csvImport.test.js` (encoding, parsing, structure, duplicate detection, row classification, no PII in results, no table changed).

## Dry-run result on the real file (aggregate; nothing written)

| Measure                                                    | Value                                                                 |
| ---------------------------------------------------------- | --------------------------------------------------------------------- |
| Encoding                                                   | Windows-1252                                                          |
| Records read                                               | 404 (17 empty unnamed columns dropped; 1 unnamed column holds values) |
| Area detected                                              | Interview schedules (Tab 7)                                           |
| Rows READY                                                 | 0                                                                     |
| Rows needing review                                        | 404                                                                   |
| Phone not accepted (lost leading zero, not repaired)       | 403                                                                   |
| Day-first text date not converted                          | 393                                                                   |
| Position has no approved mapping                           | 346                                                                   |
| Source has no approved mapping                             | 319                                                                   |
| Status has no approved mapping                             | 381                                                                   |
| No existing candidate to match (dev database is fictional) | 404                                                                   |
| Missing required value (name, phone, date or position)     | 15                                                                    |
| Exact repeats of the same phone and time                   | 0                                                                     |
| Column with no destination in the system (Mode)            | 1 (reported once)                                                     |

Every row needs review because **no mapping has been approved**: this is the framework behaving as designed, not a defect in the file.

## Field-mapping gaps (still open)

| Gap                                   | Needs                                                                                                                                           |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Candidate ID                          | An ID rule (mentor decision 14); none exists in this file                                                                                       |
| Date meaning and day-first conversion | HR confirmation that it is the interview date and that dd/mm/yyyy is intended (the guide shows dd/mm/yyyy but asks HR to confirm mixed formats) |
| Phone leading zero                    | The restore rule (add one leading 0 to 9-digit numbers) must be approved before any repair                                                      |
| Position and Source words             | An approved merge table (the guide: "mapped by a table HR approves")                                                                            |
| Status words                          | Approved mapping, including "Not Accepted by Candidate" to Offer Rejected, which is not a stage yet                                             |
| Mode (Onsite / Online)                | A destination: interview mode is not a stored field                                                                                             |
| Unnamed column with values            | Its meaning                                                                                                                                     |
| Where the 404 records go              | Interviews log vs candidates: no table holds a bare schedule row without a candidate                                                            |

## Reconciliation plan (when the real sources are supplied)

1. **Obtain the sources:** the Master candidate list (2,463), Direct_Interview (128 decided), and On Boarding Schedules (about 111) are not yet seen. Record each file's name, size and a short fingerprint, outside the repository.
2. **Counts per source:** rows read, rows blank, rows needing review, rows matched, rows to create. Compare with the guide's figures per tab and with the file's own row count.
3. **Per-tab reconciliation table:** `imported + matched + sent to review = rows read`, for every tab, with the difference explained row by row (by row number, never by name).
4. **Import report for HR to sign** before the old Excel is frozen (guide section 10).
5. **Check against the system afterwards:** candidate count, duplicates by Candidate ID, and spot counts for two sample weeks.

## Unmatched-record review plan

- Rows that match no existing candidate by phone or name go to a review list (row number, safe reference, issue code), not into the database.
- HR decides per row: attach to an existing candidate, create a new candidate (after the Candidate ID rule exists), or discard with a reason.
- Ambiguous matches (several candidates for one phone) are never attached automatically.
- Re-interviews (the same person on several dates) are kept as separate events once a destination exists; the file has 26 repeated-phone groups to decide.

## Not done, on purpose

No record was imported, no destination was chosen, and no mapping was approved. Importing needs: the master source, approved mappings, a destination for schedule rows, a Candidate ID rule, a backup, and your explicit authorization.
