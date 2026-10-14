# BUILD prompt: standard task skeleton

Use with Claude Code at the root of a new task folder to create the standard working skeleton.

---

In the current directory, create this standard task skeleton. Create each folder if it does not exist, and write a short README.md inside each one explaining its purpose (do not overwrite a README that already exists):

- `evidence/` — proof of work: screenshots, terminal output, test logs; no credentials or real personal data.
- `documentation/` — task-level write-ups: architecture notes, decisions with dates and reasons, open questions, daily logs.
- `handover/` — current state, how to run things, blockers, and exact next steps so someone else can take over.
- `closure/` — final sign-off: completion summary and checklist linking each requirement to evidence; only after validation passes.
- `validation/` — test plans and dated test-run results with input, expected, actual, pass/fail.
- `workflows/` — numbered step-by-step procedures for recurring processes.
- `sql/` — ad-hoc inspection queries; read-only unless a write is approved; migrations stay in the application repo.
- `capability/` — verified access and tooling (what works, what is pending, what is unavailable); never store secrets.
- `prompts/` — reusable AI prompts that produced good results, each with a one-line usage note.
- `data-maps/` — source-column to database-column mappings with transformation rules and unresolved items flagged.
- `query-packs/` — maintained, re-runnable query sets for audits and reports, in run order with expected healthy results.
- `duplicate-risk-reports/` — dated duplicate-detection reports with matched fields, confidence, and the decision per pair; confidential.

Then list the resulting tree so I can confirm it.
