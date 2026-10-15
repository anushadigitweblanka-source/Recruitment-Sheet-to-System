# Final Project Handover Summary (Stage 14, 2026-10-15)

Recruitment Sheet to System, built for DigitWebLanka from the official _Intern Task Guide_. This summary is the one page to read first. Detail is in the files it points to.

## 1. What is delivered

| Area                    | Delivered                                                                                                                                                                  |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Recruitment flow        | Candidates with duplicate warnings; phone interview; direct interview with total /50; automatic offer on Selected; **Prepare Offer** page; offer statuses and joining date |
| Employee lifecycle      | Employee created on Attended = Yes; evaluation, probation (one extension), junior, senior; gate decisions; Junior end date calculated from `junior_months`                 |
| Notifications           | 24-hour reminders (15-minute job), replaced on date change, no duplicates; **in-app notification bell**; email log; Monday weekly report                                   |
| Email                   | Editable templates, preview, Auto or one-click, Resend, Main User approval of the joining mail, calendar invitation (`.ics`) on the Team Lead mail                         |
| Messages                | WhatsApp / SMS text preview and **Copy Message** (nothing is sent by the system)                                                                                           |
| Reports                 | Seven reports plus the Main User-only **Salary & Offers** report; Excel, CSV and PDF export; dashboard                                                                     |
| Salary                  | Own table, Main User only, Offer List column and editor, audited without amounts                                                                                           |
| People and access       | Roles (Main User, HR, Team Lead, Intern/Dev), Team Lead scoping, users administration, append-only audit log, editable settings                                            |
| Company CV and accounts | Template and personal upload link, statuses and reminder; company accounts with an encrypted, masked, time-limited temporary password                                      |
| Data tooling            | Read-only import dry run for workbooks and **CSV** exports (Windows-1252, multi-line cells, Interview Schedules tab); PII-safe reports                                     |
| Documentation           | User guide, HR training guide, final acceptance checklist, production readiness checklist, real CSV source assessment, mentor decision lists, this summary                 |

## 2. Evidence

| Item            | Value                                                                                                                                                                                                                                    |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Automated tests | 621 backend + 404 frontend = **1,025 / 1,025** passing; build, lint and format check clean                                                                                                                                               |
| Migrations      | 001–014, applied to the development database only                                                                                                                                                                                        |
| Live checks     | Offers, reports, exports, bell and message endpoints verified against the running development app                                                                                                                                        |
| Source control  | Branch `main` of the GitHub repository `anushadigitweblanka-source/Recruitment-Sheet-to-System`. The handover documentation commit is the latest commit; confirm `git status` shows `main` level with `origin/main` before relying on it |

## 3. What this delivery is not

**Basis of the scope.** "Dummy / test data only" is the scope **reported by the project owner** as the mentor's instruction. There is no written mentor record in the repository, so it is recorded as a reported instruction, not documented approval. The official guide still lists the import as an acceptance item.

- **Not run on real data.** Everything was built and tested with fictional records. The reviewed recruitment CSV is the older Interview Schedules tab (404 records), not the 2,463-candidate master, and **nothing has been imported**.
- **No real email has ever been delivered.** A development adapter records the attempt only.
- **Not production ready.** No production database, hosting, mail provider, file storage, backups or TLS exist or were set up.
- **No formal approval is recorded.** No HR training session, demo or signature is recorded in the repository.

## 4. Open items (owners)

| Item                                                                                                                                                                                                       | Owner                  |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| Real data: master workbook, approved mappings, import authorization, reconciliation, HR-signed import report                                                                                               | Mentor, HR, Main User  |
| Real email: provider, mailbox credentials, templates, recipient addresses, one real test                                                                                                                   | Company IT, Main User  |
| Production: database, hosting, storage, backups, TLS, migration procedure                                                                                                                                  | Company IT             |
| Decisions: phone `response` values, interview `recommendation` values, work-mode list, Candidate ID rule, "Offer Rejected", failed-send retry policy, weekly report recipients, Discontinued vs Terminated | Mentor, HR             |
| HR confirmation of the Junior reading (implemented on the project owner's decision)                                                                                                                        | HR                     |
| Whether HR may save offers (`offers.manage`) and record gate decisions (`employees.manage`)                                                                                                                | Project owner          |
| HR training session, attendance and acceptance record                                                                                                                                                      | HR, trainer            |
| Final sign-off                                                                                                                                                                                             | Mentor, HR, management |

## 5. How to run and verify

1. `npm install`, then copy `.env.example` to `.env` and fill in your own development values (never commit `.env`).
2. `npm run db:migrate`, then `npm run db:create-dev-admin`.
3. `npm run dev`: app at `http://127.0.0.1:5173`, backend at `http://127.0.0.1:3000`, health at `/api/health`.
4. `npm test`, `npm run build`, `npm run lint`, `npm run format:check`.
5. Follow `documentation/hr-training-guide.md` with made-up people only.

## 6. Safety notes for the next owner

- Candidates 2002 and 2003 are protected sample records. Do not modify them.
- Use fictional data only until real data is authorized. Never commit a real CSV, workbook or `.env`.
- The audit log is append-only and users are deactivated, never deleted.
- Salary must stay Main User only. It must not reach other roles, reports, exports, mail or logs.
- The four `prompts/` files are local working notes and are not part of the project.

## 7. Where to look

| Need                              | File                                                                                   |
| --------------------------------- | -------------------------------------------------------------------------------------- |
| Status of every requirement       | `validation/final-acceptance-checklist.md`                                             |
| Detailed review and evidence      | `validation/final-signoff-review.md`                                                   |
| Going live                        | `validation/production-readiness-checklist.md`                                         |
| The CSV and the import plan       | `validation/real-csv-source-assessment.md`, `validation/real-data-import-readiness.md` |
| Setup, startup, backups, security | `handover/final-handover-checklist.md`                                                 |
| Open decisions                    | `handover/mentor-decision-list.md`                                                     |
| Training record (blank)           | `handover/hr-training-sign-off-record.md`                                              |
| Sign-off form (blank)             | `handover/final-sign-off-form.md`                                                      |
