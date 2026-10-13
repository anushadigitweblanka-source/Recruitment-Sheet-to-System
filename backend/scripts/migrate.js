// Applies pending database migrations to the development database.
// Run from the project root with: npm run db:migrate
import { loadConfig, loadEnvFile } from '../src/config/env.js';
import { runMigrations } from '../src/db/migrate.js';
import { createPool } from '../src/db/pool.js';
import { assertDevelopmentDatabase } from './devSafety.js';

let pool;
try {
  loadEnvFile();
  const config = loadConfig();
  assertDevelopmentDatabase(config);

  pool = createPool(config.db);
  const { rows } = await pool.query(
    'SELECT current_database() AS database, current_user AS "user"',
  );
  console.log(
    `Database: ${rows[0].database}   User: ${rows[0].user}   Environment: ${config.environment}`,
  );

  const applied = await runMigrations(pool, { log: (message) => console.log(message) });
  console.log(
    applied.length === 0 ? 'Nothing to apply.' : `Done: ${applied.length} migration(s) applied.`,
  );
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
} finally {
  await pool?.end();
}
