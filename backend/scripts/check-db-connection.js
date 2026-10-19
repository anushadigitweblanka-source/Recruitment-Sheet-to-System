// Checks, read-only, whether this computer can reach a PostgreSQL server and
// whether it suits the application. Run it yourself in your own terminal.
//
//   1. Set the DB_* variables (and DB_SSL) for the server in that terminal only.
//      A local .env never overrides variables that are already set.
//   2. node backend/scripts/check-db-connection.js
//
// It changes nothing: a READ ONLY transaction, privileges checked with
// has_*_privilege(), no migrations, no seed, no login to the application.
// It prints no host, user or password. A pass here proves only that THIS
// computer can connect; Vercel connects from different addresses, so the
// deployed /api/health is the test for Vercel.
import pg from 'pg';
import { loadConfig, loadEnvFile } from '../src/config/env.js';
import { classifyHost, explainConnectionError, formatReport, inspectDatabase } from './dbCheck.js';

loadEnvFile();
let exitCode = 0;
let client;
try {
  const { db } = loadConfig();
  const hostClass = classifyHost(db.host);
  const tlsMode = !db.ssl
    ? 'off (DB_SSL not set)'
    : db.ssl.rejectUnauthorized
      ? 'on, certificate verified'
      : 'on, certificate NOT verified';
  console.log(`Host location: ${hostClass}`);
  if (hostClass === 'local') {
    console.log('This is a server on this computer. Vercel cannot reach it.');
  } else if (hostClass === 'private-network') {
    console.log(
      'This looks like a private network address. Vercel cannot reach it without a secure route.',
    );
  }

  client = new pg.Client({
    host: db.host,
    port: db.port,
    database: db.database,
    user: db.user,
    password: db.password,
    ssl: db.ssl || undefined,
    connectionTimeoutMillis: 10_000,
  });
  await client.connect();
  const report = await inspectDatabase(client);
  console.log('');
  for (const line of formatReport({ hostClass, tlsMode, report })) console.log(line);
  console.log('');
  console.log('Nothing was changed.');
} catch (err) {
  console.error(explainConnectionError(err));
  exitCode = 1;
} finally {
  await client?.end().catch(() => {});
}
process.exitCode = exitCode;
