import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const MIGRATIONS_DIR = fileURLToPath(
  new URL('../../../database/migrations', import.meta.url),
);

// Applies every numbered .sql file in the migrations folder that has not been
// applied yet, in order, each inside its own transaction. `schema_migrations`
// remembers what has run. A file that was changed after being applied is an
// error: migrations are never edited, only added.
export async function runMigrations(pool, { dir = MIGRATIONS_DIR, log = () => {} } = {}) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename   text PRIMARY KEY,
      checksum   text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);

  const { rows } = await pool.query('SELECT filename, checksum FROM schema_migrations');
  const applied = new Map(rows.map((row) => [row.filename, row.checksum]));
  const files = readdirSync(dir)
    .filter((name) => /^\d+_.+\.sql$/.test(name))
    .sort();
  const newlyApplied = [];

  for (const filename of files) {
    const sql = readFileSync(path.join(dir, filename), 'utf8');
    // Line endings are ignored, so the same file checked out on Windows and on
    // Linux is recognised as unchanged.
    const checksum = createHash('sha256').update(sql.replaceAll('\r\n', '\n')).digest('hex');

    if (applied.has(filename)) {
      if (applied.get(filename) !== checksum) {
        throw new Error(`Migration ${filename} was changed after it was applied`);
      }
      continue;
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2)', [
        filename,
        checksum,
      ]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw new Error(`Migration ${filename} failed and was rolled back: ${err.message}`, {
        cause: err,
      });
    } finally {
      client.release();
    }

    log(`applied ${filename}`);
    newlyApplied.push(filename);
  }

  return newlyApplied;
}
