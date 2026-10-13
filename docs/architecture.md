# Architecture

## Overview

One repository, two parts, one database.

```
Browser  ->  React frontend  ->  /api/...  ->  Express backend  ->  PostgreSQL
```

- **Development:** Vite serves the frontend on port 5173 and forwards `/api` calls to the backend on port 3000.
- **Production:** the backend serves the built frontend from `frontend/dist`, so the application runs as a single process.

There are no microservices and no ORM. SQL is written directly and run through a shared connection pool.

## Backend layers

A request passes through three layers, each in its own file inside a feature module:

| Layer      | Responsibility                                       |
| ---------- | ---------------------------------------------------- |
| Routes     | HTTP only: read the request, call a service, respond |
| Service    | Business rules, validation, permission checks        |
| Repository | SQL queries                                          |

Permission checks (for example, who may see salary) belong in the service layer on the server. Hiding something in the frontend is never enough.

## Configuration and secrets

- All configuration comes from environment variables, read once in `backend/src/config/env.js`.
- Locally they are kept in `.env`, which is ignored by Git. `.env.example` lists the names with placeholder values.
- Secrets are never written to logs, error messages or API responses.

## Health check

`GET /api/health` returns the application status, the environment name and whether the database answered. It returns HTTP 200 when the database is reachable and 503 when it is not.

## Not built yet

Feature modules, database tables, authentication, roles, notifications, email, reports and data import. The planned modules are listed in `backend/src/modules/README.md`.
