# Database

Development database: `recruitment_system_dev` (PostgreSQL 18, local).

No tables exist yet and no migrations have been run. The table design is waiting for approval.

- `migrations/` will hold the schema changes, one numbered SQL file per change, once the design is approved.
- The application connects through `backend/src/db/pool.js` using the `DB_*` variables in `.env`.
