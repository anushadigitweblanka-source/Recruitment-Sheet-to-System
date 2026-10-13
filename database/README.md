# Database

Development database: `recruitment_system_dev` (PostgreSQL 18, local).

## Migrations

Schema changes live in `migrations/`, one numbered SQL file per change. Apply the pending ones from the project root with:

```
npm run db:migrate
```

- Each file runs in its own transaction: it applies completely or not at all.
- The `schema_migrations` table records which files have run.
- A file is never edited after it has been applied. To change something, add a new file.
- The command refuses to run when `NODE_ENV` is `production` or the database name does not end in `_dev`.

| File                          | Creates                                                                                               |
| ----------------------------- | ----------------------------------------------------------------------------------------------------- |
| `001_identity_foundation.sql` | `roles`, `permissions`, `role_permissions`, `users`, `user_credentials`, `user_sessions`, `audit_log` |

No recruitment tables exist yet. Their design is in `docs/database-schema-proposal.md` and is waiting for the decisions listed in `docs/mentor-approval-required.md`.

The application connects through `backend/src/db/pool.js` using the `DB_*` variables in `.env`.
