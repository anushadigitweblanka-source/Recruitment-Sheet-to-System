// Read-only inspection of a PostgreSQL server the application might use. It
// answers: is the host remote, is the connection encrypted and trusted, is the
// version new enough, are the tables and migrations there, and what may this
// login do. It never writes: everything runs in a READ ONLY transaction, and it
// checks privileges with has_*_privilege() instead of trying them.
//
// The report never contains the host name, the user name or the password.
import { X509Certificate } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { isIP } from 'node:net';
import { fileURLToPath } from 'node:url';

// Generated columns (migration 004) need PostgreSQL 12. Nothing newer is used.
export const MIN_SERVER_VERSION_NUM = 120000;

const MIGRATIONS_DIR = fileURLToPath(new URL('../../database/migrations/', import.meta.url));

// 'local' = this computer, 'private-network' = a company or home network that
// the public internet (and so Vercel) cannot reach, 'remote' = anything else.
export function classifyHost(host) {
  const h = String(host ?? '')
    .trim()
    .toLowerCase();
  if (!h) return 'unknown';
  if (h === 'localhost' || h === '::1' || h === '0.0.0.0' || /^127\./.test(h)) return 'local';
  if (/^10\./.test(h) || /^192\.168\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h)) {
    return 'private-network';
  }
  if (/^169\.254\./.test(h) || /^f[cd][0-9a-f]{2}:/.test(h) || /^fe80:/.test(h)) {
    return 'private-network';
  }
  if (!h.includes('.')) return 'private-network'; // a bare name only resolves inside a network
  if (/\.(local|lan|internal|corp|home|intranet|private)$/.test(h)) return 'private-network';
  return 'remote';
}

// What went wrong with a failed connection, without echoing the server address.
export function explainConnectionError(err, secrets = []) {
  const code = err?.code ?? '';
  const table = {
    SELF_SIGNED_CERT_IN_CHAIN:
      'The server certificate is signed by an authority this computer does not trust (often a company-private one).',
    DEPTH_ZERO_SELF_SIGNED_CERT:
      'The server uses a self-signed certificate. Get that certificate from the company, check its fingerprint with them, and supply it as DB_SSL_CA. Do not turn checking off.',
    UNABLE_TO_VERIFY_LEAF_SIGNATURE:
      'The certificate chain cannot be verified (a missing intermediate or private authority).',
    UNABLE_TO_GET_ISSUER_CERT_LOCALLY: 'The certificate issuer is not trusted by this computer.',
    ERR_TLS_CERT_ALTNAME_INVALID:
      'The certificate was not issued for the server name or address used. Ask IT which name it lists; if it differs, set DB_SSL_SERVERNAME to that name.',
    CERT_HAS_EXPIRED: 'The server certificate has expired.',
    ECONNREFUSED:
      'The connection was refused: nothing is accepting connections there, or a firewall refused it.',
    ETIMEDOUT: 'The connection timed out: a firewall or network path is blocking it.',
    ENOTFOUND: 'The server name could not be resolved from here.',
    EAI_AGAIN: 'The server name could not be resolved from here.',
    '28P01': 'The server rejected the login (wrong user or password).',
    28000: 'The server rejected the login (not allowed from here).',
    '3D000': 'The database does not exist for this login.',
    '57P03': 'The server is starting up or not accepting connections.',
  };
  if (table[code]) return `${table[code]} (${code})`;
  const message = String(err?.message ?? '');
  if (/does not support SSL/i.test(message)) {
    return 'The server does not accept encrypted connections, but DB_SSL is on. Ask IT whether TLS is enabled. Do not turn certificate checking off.';
  }
  if (/terminated unexpectedly/i.test(message)) {
    return 'The server closed the connection while it was starting. Usual causes: a firewall or server rule rejecting this computer, or DB_SSL not matching what the server expects.';
  }
  if (/SSL|TLS/i.test(message)) return `The TLS handshake failed (${code || 'no code'}).`;
  if (/timeout|timed out/i.test(message)) return 'The connection timed out.';
  // Unknown: show the library's own wording, with every secret value removed.
  const detail = redact(message, secrets).split('\n')[0].slice(0, 200);
  return `The connection failed (${code || 'no code'})${detail ? `: ${detail}` : '.'}`;
}

// Replaces each secret value (host, user, password) in a text with <hidden>.
export function redact(text, secrets = []) {
  let out = String(text);
  for (const secret of secrets) {
    if (secret && String(secret).length >= 3) out = out.split(String(secret)).join('<hidden>');
  }
  return out;
}

export const SETTING_NAMES = [
  'DB_HOST',
  'DB_PORT',
  'DB_NAME',
  'DB_USER',
  'DB_PASSWORD',
  'DB_SSL',
  'DB_SSL_CA',
  'DB_SSL_CA_SHA256',
  'DB_SSL_SERVERNAME',
];
const OPTIONAL_NOTE = {
  DB_SSL: ' (optional; TLS stays off unless DB_SSL_CA is set)',
  DB_SSL_CA: ' (optional; the company certificate)',
  DB_SSL_CA_SHA256: ' (optional; the fingerprint IT gave you, recommended)',
  DB_SSL_SERVERNAME: ' (optional)',
};

// SET or MISSING for each setting, never the value. DB_SSL is optional.
export function settingsStatus(env = process.env) {
  return SETTING_NAMES.map((name) => {
    const isSet = Boolean(env[name]);
    const note = !isSet ? (OPTIONAL_NOTE[name] ?? '') : '';
    return `${name.padEnd(12)} ${isSet ? 'SET' : 'MISSING'}${note}`;
  });
}

const tablesInMigrations = () => {
  const names = new Set();
  for (const file of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql'))) {
    const text = readFileSync(`${MIGRATIONS_DIR}${file}`, 'utf8');
    for (const match of text.matchAll(/CREATE TABLE\s+(?:IF NOT EXISTS\s+)?([a-z_][a-z0-9_]*)/gi)) {
      names.add(match[1].toLowerCase());
    }
  }
  return [...names].sort();
};
const migrationFiles = () =>
  readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

// Tables the signed-in application writes to during ordinary use.
const WRITE_TABLES = ['user_sessions', 'audit_log', 'users', 'user_credentials', 'candidates'];

// `client` is a connected pg client. Returns a plain-data report.
export async function inspectDatabase(client) {
  await client.query('BEGIN READ ONLY');
  try {
    const one = async (sql, params = []) => (await client.query(sql, params)).rows[0];
    const report = {};

    const version = await one('SHOW server_version_num');
    report.versionNum = Number(version.server_version_num);
    report.version = (await one('SHOW server_version')).server_version;
    report.versionOk = report.versionNum >= MIN_SERVER_VERSION_NUM;

    const db = await one('SELECT current_database() AS name');
    report.databaseName = db.name;
    report.nameEndsInDev = db.name.endsWith('_dev');

    const ssl = await one(
      'SELECT ssl, version, cipher FROM pg_stat_ssl WHERE pid = pg_backend_pid()',
    );
    report.encrypted = Boolean(ssl?.ssl);
    report.tlsVersion = ssl?.ssl ? ssl.version : null;

    const role = await one(
      'SELECT rolsuper, rolcreatedb, rolcreaterole FROM pg_roles WHERE rolname = current_user',
    );
    report.superuser = Boolean(role?.rolsuper);
    report.canCreateDatabases = Boolean(role?.rolcreatedb);
    report.canCreateRoles = Boolean(role?.rolcreaterole);
    report.canCreateTables = (
      await one(`SELECT has_schema_privilege(current_schema(), 'CREATE') AS ok`)
    ).ok;
    report.sessionReadOnly =
      (await one('SHOW transaction_read_only')).transaction_read_only === 'on';

    const present = new Set(
      (
        await client.query(
          `SELECT table_name FROM information_schema.tables
            WHERE table_schema = current_schema() AND table_type = 'BASE TABLE'`,
        )
      ).rows.map((r) => r.table_name),
    );
    const expected = tablesInMigrations();
    report.expectedTables = expected.length;
    report.missingTables = expected.filter((t) => !present.has(t));

    report.appliedMigrations = null;
    report.unappliedMigrations = null;
    if (present.has('schema_migrations')) {
      const applied = new Set(
        (await client.query('SELECT filename FROM schema_migrations')).rows.map((r) => r.filename),
      );
      const files = migrationFiles();
      report.appliedMigrations = files.filter((f) => applied.has(f)).length;
      report.unappliedMigrations = files.filter((f) => !applied.has(f));
    }

    // What the application's own use needs: sign-in alone inserts a session and an audit row.
    report.privileges = {};
    for (const table of WRITE_TABLES.filter((t) => present.has(t))) {
      const row = await one(
        `SELECT has_table_privilege(current_user, $1, 'SELECT') AS can_select,
                has_table_privilege(current_user, $1, 'INSERT') AS can_insert,
                has_table_privilege(current_user, $1, 'UPDATE') AS can_update,
                has_table_privilege(current_user, $1, 'DELETE') AS can_delete`,
        [table],
      );
      report.privileges[table] = {
        select: row.can_select,
        insert: row.can_insert,
        update: row.can_update,
        delete: row.can_delete,
      };
    }
    const grants = Object.values(report.privileges);
    report.readOnlyLogin =
      grants.length > 0 && grants.every((g) => g.select && !g.insert && !g.update && !g.delete);
    report.appCanWork = grants.length > 0 && grants.every((g) => g.select && g.insert && g.update);
    return report;
  } finally {
    await client.query('ROLLBACK');
  }
}

// Plain text lines for the terminal. Contains no host, user or password.
export function formatReport({ hostClass, tlsMode, report }) {
  const yes = (v) => (v ? 'yes' : 'no');
  const lines = [
    `Host location:            ${hostClass}`,
    `TLS requested:            ${tlsMode}`,
    `Connection encrypted:     ${yes(report.encrypted)}${report.tlsVersion ? ` (${report.tlsVersion})` : ''}`,
    `PostgreSQL version:       ${report.version} (needs 12 or newer: ${report.versionOk ? 'OK' : 'TOO OLD'})`,
    `Database name:            ${report.databaseName} (ends in _dev: ${yes(report.nameEndsInDev)})`,
    `Tables present:           ${report.expectedTables - report.missingTables.length} of ${report.expectedTables}${report.missingTables.length ? ` (missing: ${report.missingTables.join(', ')})` : ''}`,
    report.appliedMigrations === null
      ? 'Migrations applied:      no schema_migrations table (migrations not applied)'
      : `Migrations applied:      ${report.appliedMigrations}${report.unappliedMigrations.length ? ` (not yet applied: ${report.unappliedMigrations.join(', ')})` : ' (all)'}`,
    `Login is superuser:       ${yes(report.superuser)}`,
    `Login can create tables:  ${yes(report.canCreateTables)}`,
    `Login can create roles:   ${yes(report.canCreateRoles)}`,
    `Read-only login:          ${yes(report.readOnlyLogin)}`,
    `Application can sign in and work (insert/update on sessions, audit, users): ${yes(report.appCanWork)}`,
  ];
  return lines;
}

// Facts about the certificate(s) supplied as DB_SSL_CA, so they can be compared
// with the value the company publishes. Prints no subject, issuer or server name.
export function describeCertificates(pem, { host, servername } = {}) {
  const blocks =
    String(pem).match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) ?? [];
  const name = servername || host || '';
  return blocks.map((block, index) => {
    const cert = new X509Certificate(block);
    let nameMatch = 'not applicable (a certificate authority)';
    if (!cert.ca) {
      const ok = isIP(name) ? Boolean(cert.checkIP(name)) : Boolean(cert.checkHost(name));
      nameMatch = ok ? 'yes' : 'NO';
    }
    return [
      `Certificate ${index + 1} of ${blocks.length} you supplied:`,
      `  SHA-256 fingerprint: ${cert.fingerprint256}`,
      `  valid until:         ${new Date(cert.validTo).toISOString().slice(0, 10)}`,
      `  self-signed:         ${cert.issuer === cert.subject ? 'yes' : 'no'}`,
      `  name matches server: ${nameMatch}`,
    ].join('\n');
  });
}
