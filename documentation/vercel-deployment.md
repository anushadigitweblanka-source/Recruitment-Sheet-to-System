# Vercel demo deployment (fictional data only)

**Status: code and configuration are ready. Nothing has been deployed, and no hosted database exists
or has been migrated or seeded. A frontend that builds does not mean login works: that needs the
hosted database below.**

The demo uses a **separate, new** Neon PostgreSQL database named `recruitment_demo_dev` that holds
**fictional data only**. The real `recruitment_system_dev` database and the 404 historical records
stay on the local computer and are never copied, exported or uploaded.

## How it is set up

`vercel.json` (repository root) uses Vercel Services: two services, one project, one domain.

| Service    | Folder      | Framework | Public path           | Notes                                                       |
| ---------- | ----------- | --------- | --------------------- | ----------------------------------------------------------- |
| `backend`  | `backend/`  | Express   | `/api/*`              | Entry `backend/src/index.js`, which exports the app         |
| `frontend` | `frontend/` | Vite      | everything else (`/`) | Falls back to `index.html`, so `/candidates` opens directly |

- Vercel passes the original path, so `/api/candidates` reaches Express as `/api/candidates`.
- No service calls another service, so there are no bindings.
- Node is `24.x` (set in both service `package.json` files).
- `backend/src/index.js` only exports the app: no scheduler, no listener, no migrations or imports.
- Every `/api` route except `/api/health`, sign-in and the token-based candidate CV upload needs a
  signed-in user and the right permission. Salary is Main User only. A test sends signed-out requests
  to the Vercel entry app and expects 401 for each protected area.
- Local development is unchanged (`npm run dev`).

## Neon vs the existing `DB_*` settings

The app reads separate variables, not a single connection string. Take them from Neon's connection
string `postgresql://USER:PASSWORD@HOST/DBNAME?sslmode=require&channel_binding=require`:

| Variable      | Value from Neon        | Notes                                                                                                       |
| ------------- | ---------------------- | ----------------------------------------------------------------------------------------------------------- |
| `DB_HOST`     | the host               | **Pooled** host (contains `-pooler`) for Vercel; **direct** host (no `-pooler`) for migrations and the seed |
| `DB_PORT`     | `5432`                 |                                                                                                             |
| `DB_NAME`     | `recruitment_demo_dev` | Create this database inside the Neon project; the default `neondb` will not pass the safety guard           |
| `DB_USER`     | the role               |                                                                                                             |
| `DB_PASSWORD` | the role's password    | Never put it in chat, Git or `VITE_*` variables                                                             |
| `DB_SSL`      | `true`                 | Neon requires TLS (`sslmode=require`). `channel_binding` is not needed                                      |

Why pooled vs direct: Neon's pooled connection uses transaction mode, which does not support session
variables, session-level advisory locks, temporary tables or `LISTEN`. The app uses none of these, so
the pooled host suits Vercel. Neon's documentation recommends direct connections for migrations and DDL,
so apply the migrations and the seed with the direct host.

Other Vercel variables: `PUBLIC_BASE_URL` (the deployed https address; set it after the first deploy),
`NODE_ENV` (Vercel sets `production`, which makes the session cookie Secure). Leave `COMPANY_SECRET_KEY`
unset for the demo (company-account temporary passwords stay off).

Neon's Free plan suspends an idle database after 5 minutes. The first request afterwards can be slow or
time out: open `/api/health` a minute before the demonstration.

## Fictional demo data

`backend/scripts/seed-demo-data.js` fills the demo database through the application's own API, so every
record follows the real rules. It creates: 2 positions, 2 sources, 2 team leads, 9 candidates (`D-0001`
to `D-0009`, all `example.test` addresses) across Applied, Rejected, Interview Scheduled, Offer Sent,
Offer Accepted, On Hold and two employees (one in Evaluation, one in Probation), plus one restricted
supervisor account with the **HR role** (no salary, no administration).

It does nothing unless `--apply` is given. A dry run (no flag) checks the guards and prints the plan.
Guards: the database name must be exactly `recruitment_demo_dev`, end in `_dev`, `NODE_ENV` must not be
production, the host must not be this computer, the migrations must already be applied, and no
candidates, employees, offers, interviews or historical rows may exist. The supervisor password comes
from `DEMO_SUPERVISOR_PASSWORD` in your terminal; it is never printed, logged or committed.

## Not available in the demo

- Company CV uploads (no writable disk on Vercel; a storage provider is needed).
- Reminders (the 15-minute job needs a scheduler that has not been approved). Email is development
  mode only: sends are recorded as "Simulated (not delivered)".
- Historical records (the demo database has none).

## Steps (each needs your approval before it is done)

1. **Neon:** create an account and a project (Free plan; check Neon's terms), then create a database
   named `recruitment_demo_dev` and a role for the app. Copy the **direct** and **pooled** hosts.
2. **Migrations (direct host), from this computer.** In a PowerShell window set the variables for this
   session only (not in `.env`), then run:
   `$env:DB_HOST='<direct host>'; $env:DB_PORT='5432'; $env:DB_NAME='recruitment_demo_dev'; $env:DB_USER='<role>'; $env:DB_PASSWORD='<password>'; $env:DB_SSL='true'`
   `npm.cmd run db:migrate` — check that the printed line says `Database: recruitment_demo_dev`.
3. **Dry run of the seed:** `node backend/scripts/seed-demo-data.js` (changes nothing).
4. **Seed:** `$env:DEMO_SUPERVISOR_PASSWORD='<new password you choose>'; node backend/scripts/seed-demo-data.js --apply`
5. **Your own admin account (optional):** `create-dev-admin` with `DEV_ADMIN_EMAIL`, `DEV_ADMIN_NAME` and a new
   `DEV_ADMIN_PASSWORD` set in the same window. Use a password different from your local one.
6. **Vercel:** Add New → Project → import the GitHub repository. Leave the root directory as the
   repository root and the framework as detected (vercel.json defines the services). Before the first
   deploy add the environment variables (pooled host, `DB_SSL=true`, the other `DB_*` values) for the
   environment you will use. Deploy.
7. **Protect the link:** keep Vercel's Deployment Protection (Vercel Authentication) on, or create a
   shareable link. Password protection is a paid add-on and is not used.
8. **Set `PUBLIC_BASE_URL`** to the address Vercel gives, redeploy if you changed it.
9. **Test before sharing:** `/api/health` shows `connected`; sign in as the supervisor; the Candidate List
   loads nine candidates; Salary and Administration are not offered; a signed-out request to `/api/candidates`
   returns 401.
10. **Plan:** Vercel says the Hobby plan is non-commercial, personal use only. Use a paid plan for company
    use. No plan has been changed.

When the demonstration is over, delete the Neon project (or the database) and the Vercel deployment.

## Trusting a company PostgreSQL certificate (`DB_SSL_CA`)

A company server often presents its own certificate, not one a public authority signed. The error
`DEPTH_ZERO_SELF_SIGNED_CERT` means the server's certificate is signed by itself and this computer has no
reason to trust it. The safe fix is to tell the application exactly which certificate to trust. Never
switch checking off: there is no setting for that (`DB_SSL` accepts only `true` or `false`).

1. **Get the certificate from the company, not from the server.** Ask IT for the PostgreSQL server
   certificate file (`.crt` / `.pem`; for a company authority, that authority's certificate). Do not
   download it from the server and trust it: that would trust whoever answered, including an attacker.
2. **Verify it through a second trusted channel.** Ask IT for the certificate's SHA-256 fingerprint
   (by phone, or from the company's internal page). In PowerShell: `Get-FileHash -Algorithm SHA256 .\cert.pem`
   hashes the file, but the fingerprint IT quotes is of the certificate itself, so use the checker below:
   it prints the same `SHA-256 fingerprint` form that `openssl x509 -fingerprint -sha256` gives. Only go on
   when the two match exactly.
3. **Keep the file out of the repository** (for example in `C:\certs\`). It is public information, not a
   secret, but it identifies your company's server.
4. **Supply it privately.** In your PowerShell window, with the other `DB_*` values as before:
   `$env:DB_SSL_CA = Get-Content -Raw C:\certs\company-db.pem`, then
   `node backend/scripts/check-db-connection.js`. The checker prints the fingerprint, the expiry date,
   whether the certificate is self-signed and whether its name matches the server. It never prints the
   server name or the certificate text.
5. **Name matching.** The certificate must list the host name (or IP address) the application connects to.
   If it lists a different name, ask IT for that name and set `DB_SSL_SERVERNAME` to it; connecting by
   address to a certificate issued for a name is refused otherwise.
6. **On Vercel**, add `DB_SSL_CA` as an environment variable (the dashboard accepts several lines; a
   single-line form with `\n` or a base64 version also works) together with `DB_SSL=true`. It is not
   committed and not shown in logs. A certificate expires: the application refuses an expired one at
   start-up, so note the expiry date and replace the value before then.
7. The tests use throwaway fictional certificates and a fake server. They prove that the supplied
   certificate is trusted, a wrong name is refused, and a different certificate is not trusted.

## Still unverified until a real deployment

The Express entry detection, the monorepo install from the root lockfile and the frontend fallback rule
were checked against Vercel's documentation, not run.
