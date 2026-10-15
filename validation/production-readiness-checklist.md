# Production Readiness Checklist (2026-10-15)

**Status: NOT PRODUCTION READY.** The application works against a local development PostgreSQL with a development mail adapter and development file storage. Nothing below has been done on any company system.

This list records what the repository actually contains and what is still missing. **No server address, database credential, mailbox, storage provider or hosting detail is invented here**: every item marked _owner decision_ needs the company to provide it.

Legend: ✅ present in the repository · ⚠️ partly present · ❌ missing · 🔒 needs a company decision or credential.

## 1. Runtime and configuration

| Item                                                  | State | Evidence / what is missing                                                                                                                                                                             |
| ----------------------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Node 24+, `npm install`, `npm run build`, `npm start` | ✅    | `package.json` engines and scripts; in production the backend serves `frontend/dist` (`app.js`)                                                                                                        |
| Environment variables                                 | ⚠️    | Read today: `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `NODE_ENV`, `HOST`, `PORT`, `PUBLIC_BASE_URL`, `COMPANY_SECRET_KEY`, `DEV_STORAGE_DIR`. **Nothing exists for a mail provider.** |
| `.env` kept out of the repository                     | ✅    | `.gitignore`; only `.env.example` with placeholders                                                                                                                                                    |
| `COMPANY_SECRET_KEY`                                  | 🔒    | 32 random bytes (base64) generated and stored by the company in a secret store; losing it makes stored temporary passwords unreadable. Never reuse the development key                                 |
| `PUBLIC_BASE_URL`                                     | 🔒    | The real HTTPS address candidates will receive in upload links                                                                                                                                         |
| Process supervision, restart, log collection          | ❌    | No service definition, container file or CI/CD in the repository                                                                                                                                       |
| TLS / HTTPS                                           | ❌ 🔒 | Session cookies are `Secure` when `NODE_ENV=production` and will not work over plain HTTP. A TLS-terminating proxy needs `trust proxy` configured; this has **not** been exercised                     |

## 2. Database

| Item                                                   | State | Evidence / what is missing                                                                                                                                                                                                                                       |
| ------------------------------------------------------ | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Migrations 001–014 in order, checksummed, never edited | ✅    | `database/migrations`, `npm run db:migrate`                                                                                                                                                                                                                      |
| **Production migration procedure**                     | ❌    | `backend/scripts/devSafety.js` **refuses** any database whose name does not end in `_dev` or when `NODE_ENV=production`. An approved, reviewed release procedure (who runs it, from where, with what account) must be written and the guard deliberately changed |
| Dedicated least-privilege application user             | 🔒    | Dev names exist in `.env.example`; production roles are the company's choice                                                                                                                                                                                     |
| Backups and a restore test                             | ❌ 🔒 | No backup mechanism exists. Mandatory before any real data                                                                                                                                                                                                       |
| Appended audit log must not be edited                  | ✅    | Append-only by design; backups must keep it                                                                                                                                                                                                                      |
| Seed data                                              | ⚠️    | Roles, stages and settings come from migrations. Positions, sources, Team Leads and email templates start empty and need approved content                                                                                                                        |
| Real users                                             | ❌ 🔒 | Only `npm run db:create-dev-admin` for development. Production accounts via Administration → Users after the first Main User exists; no self-registration                                                                                                        |

## 3. Email

| Item                                      | State | Evidence / what is missing                                                                                                          |
| ----------------------------------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Single mail hand-off point                | ✅    | `mailService.js`: callers use `send({ to, cc, subject, body, attachments })`                                                        |
| Production adapter (SMTP or provider API) | ❌ 🔒 | Only the development adapter exists; it delivers nothing and logs the attempt                                                       |
| Company mailbox credentials               | ❌ 🔒 | Must come from the environment, never code (the guide)                                                                              |
| Calendar invitation delivery              | ⚠️    | `.ics` is built and attached to the mail object; real MIME encoding and a real calendar client have never been tested               |
| Active templates, recipients              | ❌    | No template is seeded; `reminder_hr_emails`, `reminder_manager_emails` and `weekly_report_recipients` are empty in the dev database |
| Retry policy for failed sends             | 🔒    | Not decided; failures are logged and resent by hand                                                                                 |

## 4. Files (Company CV)

| Item                                              | State | Evidence / what is missing                                                       |
| ------------------------------------------------- | ----- | -------------------------------------------------------------------------------- |
| Storage interface                                 | ⚠️    | A two-function adapter exists                                                    |
| Production storage provider                       | ❌ 🔒 | Only a local development folder (`DEV_STORAGE_DIR`); the guide names no provider |
| Malware scanning, size and type limits, retention | 🔒    | Not specified anywhere                                                           |

## 5. Security

| Item                                                                            | State | Evidence                                                      |
| ------------------------------------------------------------------------------- | ----- | ------------------------------------------------------------- |
| Passwords Argon2id, minimum 12 characters, lockout after repeated failures      | ✅    | Tests in `identity` and auth suites                           |
| Session cookie `httpOnly`, `sameSite=lax`, `secure` in production               | ✅    | `modules/auth/sessions.js`                                    |
| Server-side permissions on every module                                         | ✅    | 401/403 tests per module                                      |
| Salary only for the Main User; never in reports, exports, mail or logs          | ✅    | `stage11Salary`, `salaryOfferReport`, `offerListSalary` tests |
| Company-account temporary passwords encrypted, masked, 30-second reveal, logged | ✅    | `stage11CompanyAccounts` tests                                |
| Audit log refuses passwords, hashes, tokens and salaries                        | ✅    | `audit.js`                                                    |
| Rate limiting at the proxy, security headers, CORS policy                       | ❌    | Not implemented or reviewed                                   |
| Dependency audit (`npm audit`) and update policy                                | ❌    | Not run or documented                                         |
| Penetration or independent security review                                      | ❌    | None                                                          |

## 6. Operations

| Item                                                        | State      | Evidence / what is missing                                                                                                                                                                         |
| ----------------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Scheduler (15-minute reminders, Monday 08:00 weekly report) | ✅ in code | Runs inside the backend process (`server.js`); in production the manual trigger is refused. **Not verified on a real host**: needs a single instance (or a lock) so two processes do not both send |
| Time zone                                                   | ✅         | Asia/Colombo handled in code, independent of the server zone                                                                                                                                       |
| Health check                                                | ✅         | `GET /api/health` (environment and database)                                                                                                                                                       |
| Monitoring and alerting on failed sends                     | ❌         | The Email Log and notification bell show failures; nothing alerts operations                                                                                                                       |
| Deployment configuration                                    | ❌         | None                                                                                                                                                                                               |
| Disaster recovery, data retention, personal-data policy     | 🔒         | Candidate data is personal (guide section 8); the company must define retention and access                                                                                                         |

## 7. Go-live gates (in order)

1. Company decisions: hosting, database, mail provider, file storage, backup owner, TLS.
2. Provision a production database and application user; take and restore-test a backup.
3. Write and approve the migration release procedure; run migrations 001–014 on an empty production database.
4. Configure secrets in the environment: database, `COMPANY_SECRET_KEY`, mail provider, `PUBLIC_BASE_URL`.
5. Create the first Main User; create real accounts; keep development accounts out.
6. Enter approved positions, sources, Team Leads, templates and recipient addresses.
7. Send one real test mail and one real reminder to company addresses; open the `.ics` in a real calendar.
8. Run the acceptance checklist again on the production system.
9. Import historical data only after its own authorization (`validation/real-data-import-readiness.md`).
10. Record go-live sign-off.
