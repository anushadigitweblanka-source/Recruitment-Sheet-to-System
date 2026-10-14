# query-packs/

Curated sets of queries that are run together for a defined purpose, such as a pre-import audit, a post-import verification, or a weekly report.

- One pack per folder or file, with the queries in run order and a note on what each result should look like when healthy.
- Unlike `sql/` (ad-hoc, one-off), a pack is maintained and re-run; keep it current when the schema changes.
