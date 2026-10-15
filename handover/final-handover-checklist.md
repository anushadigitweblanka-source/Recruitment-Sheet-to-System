# Final Handover Checklist (2026-10-15)

Everything a new owner needs to run and verify the system. **No credentials appear in this document or anywhere in the repository.**

## Scope (reported instruction, not documented approval)

The **current internship task uses dummy/test data only**, as reported by the project owner as the mentor's instruction; **no written record of that instruction exists in this repository**, so it is a reported instruction, not documented approval. This checklist is therefore split in two:

- **A. Current internship completion scope** — the dummy-data application, its tests, the user guide, the HR training/demo material, the remaining mentor decisions, and the final sign-off. Everything in part A below.
- **B. Future / go-live work** — real workbook import, production database, real user accounts, production mail provider, deployment and backups. **Part B is future work and is NOT required for the current internship completion, unless the mentor later changes the scope.** It is kept here so the official guide's full requirements remain documented.

---

# A. CURRENT INTERNSHIP COMPLETION SCOPE

## Application setup

- [ ] Node.js **24+** installed (`package.json` engines).
- [ ] PostgreSQL server available.
- [ ] `npm install` at the repository root (npm workspaces: `backend/` + `frontend/`).
- [ ] Copy `.env.example` to `.env` at the root and fill in your own values. `.env` is git-ignored and must stay that way.

## Database

- [ ] Create a PostgreSQL database and a dedicated application user (dev names suggested in `.env.example`: `recruitment_system_dev` / `recruitment_app_dev`).
- [ ] Run migrations: `npm run db:migrate`. Migrations are **001–014**, applied in order, checksummed, never edited after applying — only new ones are added.
- [ ] Note: the dev database contains fictional leftovers kept deliberately — deactivated test accounts `viewer@example.test`, `users-test@example.test`, `auto.offer@example.test` and the empty `test_accept_viewer` role — because the **append-only audit log** references them. Candidates **2002 and 2003 are protected sample records: never modify them.**

## Environment variables

From `.env.example` (values are yours, never committed): `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, and for the one-time dev sign-in bootstrap `DEV_ADMIN_EMAIL`, `DEV_ADMIN_NAME`, `DEV_ADMIN_PASSWORD` (12+ characters; use a made-up address). Optional: `PORT` (backend, default 3000), `NODE_ENV`.

## Startup

- [ ] Development (both servers, hot reload): `npm run dev` → frontend at http://127.0.0.1:5173, backend at http://127.0.0.1:3000.
- [ ] Health check: `GET /api/health` reports environment and database connectivity.
- [ ] Build check: `npm run build` (frontend → `frontend/dist`); `npm start` runs the backend alone. Production hosting is part B — not required now.

## Login

- [ ] Create the first account: `npm run db:create-dev-admin` (reads the `DEV_ADMIN_*` values; role `main_user`).
- [ ] Sign in; further accounts are created under **Administration → Users** (fictional ones for the current scope). No self-registration exists, by design.
- [ ] Passwords: Argon2id-hashed, minimum 12 characters; 5 failed attempts pause the account temporarily.

## Migrations policy

- [ ] Never edit an applied migration (the runner refuses changed checksums). New schema = new numbered file.
- [ ] **Pending, mentor-approval-required migrations (do not create yet):** `candidates.is_historical`, `candidates.applied_on`, import batch/review tables, `position_aliases` — all belong to the real-data import plan in part B (future work).

## Tests and quality gate

- [ ] `npm test` — 621 backend + 404 frontend = **1,025 tests**, all green at handover. Backend tests use throwaway schemas; they need the database from `.env`.
- [ ] `npm run build`, `npm run lint`, `npm run format:check` — all clean at handover.

## Backup

- [ ] No automated backup exists, and none is required while the data is dummy/test only. Backups become mandatory in part B, before any real data exists.

## GitHub

- [ ] Repository: `github.com/anushadigitweblanka-source/Recruitment-Sheet-to-System`, branch `main`. Latest commit at this review: see `git log` (the Stage 14 work is committed; pushed state is in `handover/final-project-handover-summary.md`).
- [ ] Working tree extras that stay local: the final handover pack (this file and its siblings) until reviewed and pushed, and the untracked `prompts/` files (local working notes — do not push).
- [ ] `.env` and real data are never committed. CSV/workbook files with real people must never enter the repository.

## Unresolved mentor decisions

See **`handover/mentor-decision-list.md`** — the single consolidated list, split into decisions that affect the current dummy-data scope and the future/go-live ones. Nothing on that list is implemented by guesswork anywhere in the system; blocked features refuse input or are absent, with the decision named in the docs.

## Final sign-off (current scope)

Sign-off for the current internship completion is based on: the dummy-data demo (see `documentation/hr-training-guide.md`), the automated test results (1,025/1,025), the completed user guide, the completed HR training material, the remaining mentor decisions either resolved or formally deferred, and mentor/HR approval. **It does not require real data.**

## Security warnings

- [ ] Secrets live only in `.env`; nothing in the repo or the audit log ever contains a password, hash, token or salary (the audit writer refuses them at any depth).
- [ ] All permissions are enforced in the **backend** (401/403); the UI hiding a button is never the only protection.
- [ ] **Salary is Main User only**: stored in `offer_salary`, shown on the offer details page, the Offer List column and the Salary & Offers report, every view and change audited without the amount. It must never reach HR, Team Lead, Intern / Dev, reports, exports, mail or logs.
- [ ] **No real employee or candidate PII may be used** â€” dummy/test data only (the reported scope above). Candidates 2002 and 2003 stay untouched.
- [ ] Mail is in **development mode**: nothing is ever delivered. A real provider belongs to part B and needs separate approval.
- [ ] Users are deactivated, never deleted; the audit log is append-only. Do not "clean up" either.

---

# B. FUTURE / GO-LIVE WORK — NOT REQUIRED FOR CURRENT INTERNSHIP COMPLETION

Kept so the official guide's full requirements stay documented. Under the reported scope none of this is needed now unless the scope is changed; **the official guide itself still lists the import as an acceptance item.** **Classification: DEFERRED under the reported scope, pending written confirmation.**

## Real-data import (deferred)

- The real workbook import (the company's candidate sheet) is **not required for current internship completion**. Nothing has started, deliberately.
- Ready when the time comes: the dry-run validation framework (`npm run import:dry-run -- "<workbook.xlsx>"` → PII-safe report under `validation/import-dry-run/`, hard read-only guard), the readiness gate (`validation/real-data-import-readiness.md`, all items unchecked), and the plan (`workflows/real-data-import.md`). The importer itself would be a separate reviewed code path.

## Go-live steps (deferred, in order)

1. Mentor's future/go-live decisions collected (import approvals, mail provider — see the decision list).
2. Production database provisioned; migrations run; backup schedule in place and restore-tested.
3. Real user accounts created; dev/test accounts stay deactivated.
4. Mail provider approved and configured; development mode off; recipients per the mentor's reminder rules.
5. Real-data import: readiness checklist fully checked → dry-run on the real workbook → review → approved migrations → import → verification against the sheet.
6. Acceptance re-run on production data.
7. Go-live sign-off recorded.
