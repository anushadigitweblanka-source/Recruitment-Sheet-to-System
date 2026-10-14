# validation/import-dry-run/

Reports produced by `npm run import:dry-run -- "<workbook>"`. One Markdown file per run, named `YYYY-MM-DD-HH-mm-<workbook name>.md`.

- Every report is from a **dry run**: no recruitment data was written, no email sent.
- Reports are PII-safe by construction: they carry the sheet name, row number, Candidate ID (the approved safe reference), issue code and explanation — never phone numbers, emails, names or addresses from the workbook.
- If a report from a **real** workbook ever appears to contain personal data beyond candidate IDs, do not commit it; report the gap so the report writer is fixed first.
- Reports are evidence for the readiness checklist (`../real-data-import-readiness.md`); keep the final pre-import run's report.
