# sql/

Ad-hoc and reference SQL used during the task: inspection queries, data checks, and one-off analysis scripts.

- Schema migrations do NOT live here — they belong in `recruitment-sheet-to-system/database/migrations/` as numbered files.
- Name files by purpose (e.g. `count-candidates-by-stage.sql`).
- Queries must be read-only against development data unless a write is explicitly approved; say so in a comment at the top of the file.
