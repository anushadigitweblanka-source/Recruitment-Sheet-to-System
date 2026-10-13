# Recruitment Sheet to System

A web application that replaces a spreadsheet-based recruitment tracker and adds employee lifecycle tracking after hiring: candidates, phone screening, interviews, offers, joining, evaluation, probation, junior and senior stages, with reminders and reports.

**Current state: application shell only.** The frontend has its layout, navigation and placeholder pages; the backend and database connection start, and a system status page proves they work together. No feature modules, database tables or migrations exist yet, and no page shows real or sample data.

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
    routes/            API routes, all mounted under /api
    middleware/        shared Express middleware
    modules/           one folder per module (documentation only so far)
    app.js             builds the Express app
    server.js          starts the server
  tests/               backend tests
frontend/
  src/
    navigation.js      assembles the sidebar and the routes from the modules
    modules/           the six modules; each folder declares its own pages
    layouts/           the header + sidebar frame around every page
    components/        reusable pieces (tables, cards, badges, form controls)
    pages/             pages outside the modules (dashboard, system status)
    api/client.js      the one place that calls the backend
  tests/               frontend tests
database/
  migrations/          schema changes (none yet)
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

### Environment variables

| Name          | Required | Purpose                                          |
| ------------- | -------- | ------------------------------------------------ |
| `DB_HOST`     | yes      | PostgreSQL host                                  |
| `DB_PORT`     | yes      | PostgreSQL port                                  |
| `DB_NAME`     | yes      | Database name (`recruitment_system_dev` for dev) |
| `DB_USER`     | yes      | Application login                                |
| `DB_PASSWORD` | yes      | Password for the application login               |
| `PORT`        | no       | Backend port, default `3000`                     |
| `HOST`        | no       | Backend bind address, default `127.0.0.1`        |
| `NODE_ENV`    | no       | `development` (default), `test` or `production`  |

The backend refuses to start if a required variable is missing, and names the missing variables.

## Starting the application

Development (backend and frontend together, both restart on change):

```
npm run dev
```

- Frontend: http://127.0.0.1:5173
- System status page: http://127.0.0.1:5173/admin/system-status
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

The health check tests connect to the development database named in `.env`, so PostgreSQL must be running. They only run `SELECT 1` and do not create or change anything.

## Database

- Development database: `recruitment_system_dev`
- No tables have been created. Schema changes will be added as numbered SQL files in `database/migrations/` once the design is approved.
- Real candidate data must not be loaded into a development database without approval.
