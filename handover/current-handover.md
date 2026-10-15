# Current Handover (2026-10-15, final handover / mentor decision stage)

## CURRENT STAGE

**Final Handover / Mentor Decision Stage.** The application is feature-complete for the current scope; what remains is mentor decisions, the code they unblock, the HR/mentor demo and the final sign-off.

## DATA POLICY

**Dummy/test data only, by current mentor instruction.** No real employee or candidate PII may be used anywhere.

## REAL DATA

**Deferred — not required for the current internship completion scope.** The real workbook import (and its approvals, mappings and migrations) is future work. The dry-run framework stands ready for that day (`npm run import:dry-run`, `validation/real-data-import-readiness.md`, `workflows/real-data-import.md`).

## PRODUCTION GO-LIVE

**Future work, outside the current internship completion scope unless the mentor later requests it.** Production database, hosting, backups, real user accounts and a real mail provider all belong to that future phase — see part B of `handover/final-handover-checklist.md`.

## State

- origin/main: `c354a53` (automatic offer creation) on top of `3a1369f` (read-only roles & permissions view), `9515858` (users administration), `9eb49ca` (CSV BOM lint fix), `25bf1d2` (settings + audit log), `cec7d82` (exports), `97a56ae` (reports), `4428ed7` (dashboard), `ce312c0` (acceptance), `f05c5ae` (data maps), `10377c0` (import dry-run framework), `cebbb09`, `a2f5ba5` (Module 6).
- **Uncommitted, awaiting the user's review before any commit:** the final dummy-data handover pack — `documentation/user-guide.md`, `documentation/hr-training-guide.md`, `handover/final-handover-checklist.md` (split into current scope vs future/go-live), `validation/final-acceptance-checklist.md` (dummy-data completion basis), `handover/mentor-decision-list.md` (current-scope decisions 1–15; future/go-live 16–17), and this handover update. The local-only prompts stay uncommitted.
- Modules: Authentication + 1–6 complete within the confirmed scope (Module 6 has 5 open mentor decisions; automatic notification creation OFF). Dashboard, Reports and Excel/CSV/PDF exports live from the database. Settings, Audit Log, Users administration and the read-only Roles & Permissions view are real pages — **no placeholder pages remain**. The automatic offer on direct-interview Selected is pushed. Fictional deactivated accounts viewer@example.test, users-test@example.test and auto.offer@example.test remain in the dev DB because the append-only audit log references them. The scheduled weekly email remains not started (mentor-blocked recipients).
- Test suite: 430 backend + 341 frontend = 771 green; build/lint/format clean.
- Database: dev only, migrations 001–008. Local candidates `2002` and `2003` are pre-existing records that must not be modified — verified untouched.
- No real recruitment data anywhere; no mail provider (development mode); no salary anywhere.

## How to verify

`npm test` (backend 430 + frontend 341), `npm run build`, `npm run lint`, `npm run format:check` — all green at handover time.

## Blocked / waiting (current scope)

- The mentor decisions in `handover/mentor-decision-list.md`, items 1–15 (Module 6 rules, field value lists, junior 9-month rule, discontinued/terminated confirmation, final roles, salary design, offer questions, candidate ID format, duplicate criteria). A ready conversation prompt for the Module 6 items is in `prompts/module6-mentor-decisions-continuation.md` (local).

## Exact next steps

1. User reviews the handover pack, then commit + push it.
2. Take the mentor decision list to the mentor; build and review whatever the answers unblock (or record items as formally deferred).
3. Run the HR/mentor demo using `documentation/hr-training-guide.md`.
4. Final sign-off on the dummy-data basis: demo + 771 automated tests + user guide + training material + decisions resolved-or-deferred + mentor/HR approval.
