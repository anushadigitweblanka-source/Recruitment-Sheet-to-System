# Position / Source Mapping — Workbook spellings → Approved lookup rows (2026-10-14)

**Status: EMPTY TEMPLATE, awaiting confirmed values.** The `positions` and `sources` tables start empty by design; an administrator adds the approved values under Administration → Positions & Sources, and HR approves which raw workbook spelling maps to which approved value (the guide's position-name merge, e.g. several "Automation" spellings → one approved position). **No company position or source is invented here.** Rows are added only when values are confirmed.

Rules:

- Every distinct raw spelling found in the workbook gets one row.
- `Target ID` is the id of the approved row in `positions`/`sources` — filled only after the approved value exists in the system.
- A raw spelling with no approved mapping keeps Status = REVIEW REQUIRED and the candidate rows carrying it go to the import review queue.
- The proposal's `position_aliases` table would hold this mapping in the database; until that migration is approved, this file is the working copy.

| Type     | Raw Source Value | Approved Value | Target ID | Status | Reviewed By | Notes                                                                                                                                  |
| -------- | ---------------- | -------------- | --------- | ------ | ----------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Position |                  |                |           |        |             | awaiting approved position list (mentor decision 6)                                                                                    |
| Source   |                  |                |           |        |             | awaiting approved source list (mentor decision 6); "Historical" must not replace the real source — a separate flag is proposed instead |
