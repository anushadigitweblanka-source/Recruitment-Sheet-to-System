# Report Exports Validation (2026-10-14)

Live verification against the running development app, fictional EXP-TEST-* data only (EXP-TEST-001/002, export1@example.test, "EXP-TEST Position"); generated files written to the system temp directory, never into the repository; all test records removed afterwards.

| Check                                                            | Expected                              | Actual                                              | Result |
| ---------------------------------------------------------------- | ------------------------------------- | --------------------------------------------------- | ------ |
| Export without login                                             | 401                                   | 401                                                 | PASS   |
| On-screen filtered rows (positionId filter)                      | the two EXP-TEST rows                 | EXP-TEST-002, EXP-TEST-001                          | PASS   |
| XLSX download: content type + workbook parses (exceljs)          | spreadsheetml; rows = screen rows     | MATCH                                               | PASS   |
| CSV download: UTF-8 BOM + both filtered rows                     | yes                                   | yes                                                 | PASS   |
| PDF download: %PDF header, non-trivial size, attachment filename | yes                                   | %PDF-, 2,340 bytes, candidate-status-2026-10-14.pdf | PASS   |
| Aggregate report export (funnel XLSX) carries the Rejected count | present                               | present                                             | PASS   |
| Salary/credential words in any file                              | never                                 | none                                                | PASS   |
| Cleanup: EXP-TEST rows removed; remaining candidates             | only 2002, 2003, timestamps unchanged | confirmed                                           | PASS   |

Automated: 12 backend + 5 frontend export tests green; full suite **392 backend + 322 frontend = 714 passing** (verified stable across six consecutive backend runs; one transient failure occurred only while the dev server, importer tests and schedulers shared the database during a combined run). Build, lint and Prettier clean. New dependency: `pdfkit` (backend).

Not in scope (by design): the scheduled weekly email (mentor-blocked recipients), exports of reports that do not exist, any salary field.
