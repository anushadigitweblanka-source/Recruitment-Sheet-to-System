# Recruitment Sheet to System

A web application that replaces a spreadsheet-based recruitment tracker and adds employee lifecycle tracking after hiring: candidates, phone screening, interviews, offers, joining, evaluation, probation, junior and senior stages, with reminders and reports.

**Current state: sign-in works; the six modules are screens only.** Users sign in with an email and password, every page and API route requires a signed-in user, and signing out ends the session on the server. The six recruitment modules have their screens but are not connected to data yet, and no page shows real or sample data.

## Stack

| Part     | Technology                                      |
| -------- | ----------------------------------------------- |
| Backend  | Node.js 24, Express 5                           |
| Database | PostgreSQL 18, accessed with `pg` (pool)        |
| Frontend | React 19, built with Vite                       |
| Tests    | Node's test runner (backend), Vitest (frontend) |
| Tooling  | ESLint, Prettier                                |

The stack is provisional until confirmed by the project mentor.

## Project structure

```
backend/
  src/
    config/env.js      reads and validates environment variables
    db/pool.js         PostgreSQL connection pool and health check
    db/migrate.js      applies the SQL files in database/migrations
    routes/            API routes, all mounted under /api
    middleware/        shared Express middleware (sign-in and permission checks)
    modules/auth/      sign-in, sign-out, sessions and password hashing
    modules/audit/     writes the audit log
    modules/           the six recruitment modules (documentation only so far)
    app.js             builds the Express app
    server.js          starts the server
  scripts/             database setup commands
  tests/               backend tests
frontend/
  src/
    auth/              sign-in state and the guard around protected pages
    navigation.js      assembles the sidebar and the routes from the modules
    modules/           the six modules; each folder declares its own pages
    layouts/           the header + sidebar frame around every page
    components/        reusable pieces (tables, cards, badges, form controls)
    pages/             pages outside the modules (sign-in, dashboard, system status)
    api/client.js      the one place that calls the backend
  tests/               frontend tests
database/
  migrations/          schema changes, one numbered SQL file each
docs/                  architecture notes
```

## Prerequisites

- Node.js 24 or later (includes npm)
- PostgreSQL 18 running locally on port 5432
- Git

## Local development setup

1. Install dependencies from the project root:

   ```
   npm install
   ```

2. Create the development database `recruitment_system_dev` and a dedicated, non-superuser login that owns it.

3. Copy `.env.example` to `.env` and fill in the values. `.env` is ignored by Git and must never be committed.

4. Create the database tables:

   ```
   npm run db:migrate
   ```

5. Create your development sign-in account. In `.env`, set `DEV_ADMIN_EMAIL`, `DEV_ADMIN_NAME` and a `DEV_ADMIN_PASSWORD` of your own choosing (at least 12 characters), then run:

   ```
   npm run db:create-dev-admin
   ```

   Use a made-up email address, never a real person's. The password is hashed before it is stored and is never printed. Run the command again after changing the values to update the account.

Both commands refuse to run when `NODE_ENV` is `production` or when the database name does not end in `_dev`.

### Environment variables

| Name                 | Required   | Purpose                                          |
| -------------------- | ---------- | ------------------------------------------------ |
| `DB_HOST`            | yes        | PostgreSQL host                                  |
| `DB_PORT`            | yes        | PostgreSQL port                                  |
| `DB_NAME`            | yes        | Database name (`recruitment_system_dev` for dev) |
| `DB_USER`            | yes        | Application login                                |
| `DB_PASSWORD`        | yes        | Password for the application login               |
| `DEV_ADMIN_EMAIL`    | for step 5 | Email of the development sign-in account         |
| `DEV_ADMIN_NAME`     | for step 5 | Display name of that account                     |
| `DEV_ADMIN_PASSWORD` | for step 5 | Password of that account; development only       |
| `PORT`               | no         | Backend port, default `3000`                     |
| `HOST`               | no         | Backend bind address, default `127.0.0.1`        |
| `NODE_ENV`           | no         | `development` (default), `test` or `production`  |

The backend refuses to start if a required variable is missing, and names the missing variables.

## Signing in

- Sign-in is by email and password at `/login`. There is no self-registration.
- Passwords are stored only as Argon2id hashes, in a table separate from the user's details.
- The session is kept in an HTTP-only cookie. It ends after 60 minutes without activity, 8 hours after sign-in, or on Logout.
- After 5 wrong passwords in a row, sign-in for that account is paused for 15 minutes.
- Every API route except the health check and sign-in requires a signed-in user. This is enforced on the server, not only in the pages.
- Sign-ins, failed sign-ins and sign-outs are written to the audit log.

## Starting the application

Development (backend and frontend together, both restart on change):

```
npm run dev
```

- Application (opens the sign-in page): http://127.0.0.1:5173
- System status page, after signing in: http://127.0.0.1:5173/admin/system-status
- Backend health check: http://127.0.0.1:3000/api/health

To run one side only, use `npm run dev:backend` or `npm run dev:frontend`.

Production-style run (the backend serves the built frontend as one process):

```
npm run build
```

Then set `NODE_ENV=production` in the environment and run:

```
npm start
```

## Tests and code quality

```
npm test              run the backend and frontend tests
npm run lint          check code with ESLint
npm run format        format code with Prettier
npm run format:check  check formatting without changing files
```

The backend tests connect to the development database named in `.env`, so PostgreSQL must be running. Tests that need tables build them in a throwaway schema (named `test_…`) and drop it afterwards; the real tables are never read or written by a test.

## Database

- Development database: `recruitment_system_dev`
- Migration 001 creates the identity tables: `roles`, `permissions`, `role_permissions`, `users`, `user_credentials`, `user_sessions` and `audit_log`. `schema_migrations` records which migrations have run.
- No recruitment tables exist yet. They are added as further numbered SQL files in `database/migrations/` once their design is approved.
- A migration file is never edited after it has been applied; changes go in a new file.
- Real candidate data must not be loaded into a development database without approval.
