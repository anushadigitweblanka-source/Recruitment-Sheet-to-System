// Checks, read-only, whether this computer can reach a PostgreSQL server and
// whether it suits the application. Run it yourself in your own terminal.
//
//   1. Set the DB_* variables (and DB_SSL) for the server in that terminal only.
//      A local .env never overrides variables that are already set.
//   2. node backend/scripts/check-db-connection.js
//
// It changes nothing: a READ ONLY transaction, privileges checked with
// has_*_privilege(), no migrations, no seed, no login to the application.
// It prints no host, user or password: settings are shown only as SET or MISSING.
// A pass here proves only that THIS computer can connect; Vercel connects from
// different addresses, so the deployed /api/health is the test for Vercel.
import pg from 'pg';
import { loadConfig, loadEnvFile } from '../src/config/env.js';
import {
  classifyHost,
  describeCertificates,
  explainConnectionError,
  formatReport,
  inspectDatabase,
  settingsStatus,
} from './dbCheck.js';

loadEnvFile();

// Step 1: are the settings there? Nothing is contacted in this step.
console.log('Step 1 - settings found (values are never shown):');
for (const line of settingsStatus()) console.log(`  ${line}`);
let db;
try {
  ({ db } = loadConfig());
} catch (err) {
  // loadConfig names the missing or invalid variables and never prints a value.
  console.error('');
  console.error(`Settings problem: ${err.message.split('. ')[0]}.`);
  console.error('Nothing was contacted. Set the missing values in this terminal and run it again.');
  process.exit(1);
}

// Step 2: connect and inspect.
const hostClass = classifyHost(db.host);
const tlsMode = !db.ssl
  ? 'off (DB_SSL not set)'
  : db.ssl.ca
    ? 'on, verified against the certificate you supplied (DB_SSL_CA)'
    : 'on, certificate verified (public authorities)';
console.log('');
if (db.ssl?.ca) {
  console.log('Step 1b - the certificate you supplied. Compare this fingerprint with the one');
  console.log('IT gave you through a trusted channel before going on:');
  const certificates = describeCertificates(db.ssl.ca, {
    host: db.host,
    servername: db.ssl.servername,
  });
  for (const block of certificates) {
    console.log(
      block
        .split('\n')
        .map((line) => `  ${line}`)
        .join('\n'),
    );
  }
  console.log('');
}
console.log('Step 2 - connecting (read-only):');
console.log(`  Host location: ${hostClass}`);
if (hostClass === 'local') {
  console.log('  This is a server on this computer. Vercel cannot reach it.');
} else if (hostClass === 'private-network') {
  console.log(
    '  This looks like a private network address. Vercel cannot reach it without a secure route.',
  );
}

let client;
let exitCode = 0;
try {
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
  console.error('');
  console.error(explainConnectionError(err, [db.host, db.user, db.password]));
  exitCode = 1;
} finally {
  await client?.end().catch(() => {});
}
process.exitCode = exitCode;
