import pg from 'pg';

export function createPool(dbConfig) {
  const pool = new pg.Pool({
    host: dbConfig.host,
    port: dbConfig.port,
    database: dbConfig.database,
    user: dbConfig.user,
    password: dbConfig.password,
    // Optional: work inside one named schema instead of the default. The tests
    // use this to run against a throwaway schema.
    options: dbConfig.schema ? `-c search_path=${dbConfig.schema}` : undefined,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });

  // An idle client can fail (for example if the server restarts). Without this
  // handler the error would crash the process.
  pool.on('error', (err) => {
    console.error(`Database pool error: ${err.code ?? err.message}`);
  });

  return pool;
}

// Runs a trivial query to prove the connection works. Never throws.
export async function checkDatabase(pool) {
  const startedAt = Date.now();
  try {
    await pool.query('SELECT 1');
    return { ok: true, latencyMs: Date.now() - startedAt };
  } catch (err) {
    console.error(`Database health check failed: ${err.code ?? err.message}`);
    return { ok: false };
  }
}
