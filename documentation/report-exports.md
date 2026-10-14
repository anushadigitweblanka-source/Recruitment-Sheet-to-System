# Report Exports (built 2026-10-14, uncommitted pending review)

Every report can be downloaded as **Excel (.xlsx)**, **CSV** or **PDF**. The file is built from the **same repository functions and filter parsers as the on-screen report**, so an export always matches the filtered screen — there is no separate business logic, only column definitions and format rendering (`backend/src/modules/reports/reports.export.js`).

## Endpoint and permission

`GET /api/reports/:report/export?format=xlsx|csv|pdf` — one route for all seven reports (`candidate-status`, `funnel`, `sources`, `positions`, `weekly`, `onboarding`, `exit`). Same `candidates.view` permission as the screens: 401 unauthenticated, 403 without permission, 404 for an unknown report or format. All current filters pass through unchanged (stage/position/source/date-added; movement range; `weekStart`; join-date range; exit-date range). An export returns the whole filtered result, not one page (capped at 10,000 rows as a runaway guard).

## Formats

- **Excel** (exceljs, already a dependency): title, generated timestamp (Asia/Colombo), applied-filter lines, bold headers, sensible column widths; an empty filtered report is still a valid workbook with headers. Content type `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`.
- **CSV**: UTF-8 with a BOM (so spreadsheets read the encoding), CRLF rows, headers + data only; commas, quotes and newlines escaped by RFC-style quote doubling. Content type `text/csv; charset=utf-8`.
- **PDF** (pdfkit, new dependency): "Recruitment System" + report title + generated time + applied filters, plain ruled table, landscape for wide reports, header repeated on each new page, page numbers ("Page n of m"), an explicit "no rows" line for empty reports. Content type `application/pdf`.

Filenames: `<report>-YYYY-MM-DD.<ext>` (Asia/Colombo date) via `Content-Disposition: attachment`.

## Columns per report

Exactly the fields the screen shows, nothing more: candidate-status (Candidate ID, Name, Position, Source, Current Stage, Stage Since, Added); funnel (Stage, Candidates There Now, Entered During Period); sources/positions (name, Candidates, In Progress, Joined, Rejected, On Hold, No Show/No Response); weekly (metric/value rows: applications, offers sent/accepted, joined, rejected, per-stage movements, with the week range stated); onboarding (Candidate ID, Employee, Position, Join Date, Track, Current Phase, Status); exit (Candidate ID, Employee, Position, Join Date, Exit Type, Exit Date, Reason).

**Never included:** salary (none exists), credentials, internal numeric ids, team-lead fields.

## Frontend

Each report tab has Export Excel / Export CSV / Export PDF buttons that send the tab's **current filter values**, show "Preparing…" while busy (all three disabled), show an error notice on failure, and download in place via a Blob + the backend's filename — the session travels in the cookie as usual, no token handled.

## Known limitations

- The scheduled **weekly email is still not implemented** (recipients are a mentor decision); the weekly export is the on-screen dataset as a file.
- Weekly "Applications" remains the candidates-added proxy until `applied_on` is approved.
- Generated files are never committed to the repository.

## Tests

`backend/tests/reportExports.test.js` (12): 401/403, unknown report/format 404, xlsx parseable with correct title/headers/rows, CSV BOM + escaping (comma/quote/newline fixture) + exact renderer cases, PDF magic header and size, filter parity with the screen, valid empty export, weekly week filter, all 7×3 combinations, and a no-sensitive-words sweep. `frontend/tests/reportExports.test.jsx` (5): buttons present, export uses current report/format/filters and triggers a download, route follows the selected tab, failure shows the error, buttons disable while preparing.
