import { X509Certificate } from 'node:crypto';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT_ENV_FILE = fileURLToPath(new URL('../../../.env', import.meta.url));

const REQUIRED_DB_VARS = ['DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'DB_PASSWORD'];

// Loads the local .env file if there is one. In production the variables are
// expected to come from the real environment, so a missing file is not an error.
export function loadEnvFile(path = ROOT_ENV_FILE) {
  if (existsSync(path)) {
    process.loadEnvFile(path);
  }
}

function parsePort(name, value) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid configuration: ${name} must be a port number between 1 and 65535`);
  }
  return port;
}

// A certificate the database server's certificate must match or be signed by:
// the company's certificate authority, or the server's own self-signed
// certificate, once its fingerprint has been checked with the company. Accepts
// the PEM text (real line breaks, or "\n" written out on one line) or that text
// base64-encoded. Only certificates are accepted: a private key is refused.
function readCaCertificate(raw) {
  let text = String(raw).trim();
  if (!text.includes('-----BEGIN')) {
    const decoded = Buffer.from(text, 'base64').toString('utf8');
    if (decoded.includes('-----BEGIN')) text = decoded;
  }
  text = text.replace(/\\n/g, '\n');
  if (/PRIVATE KEY/.test(text)) {
    throw new Error(
      'Invalid configuration: DB_SSL_CA must hold a certificate, never a private key',
    );
  }
  const blocks = text.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g);
  if (!blocks) {
    throw new Error('Invalid configuration: DB_SSL_CA must contain a PEM certificate');
  }
  const now = new Date();
  for (const block of blocks) {
    let cert;
    try {
      cert = new X509Certificate(block);
    } catch {
      throw new Error('Invalid configuration: DB_SSL_CA holds a certificate that cannot be read');
    }
    if (new Date(cert.validTo) < now) {
      throw new Error('Invalid configuration: a certificate in DB_SSL_CA has expired');
    }
    if (new Date(cert.validFrom) > now) {
      throw new Error('Invalid configuration: a certificate in DB_SSL_CA is not valid yet');
    }
  }
  return blocks.join('\n');
}

// The fingerprint the company gave you (through a trusted channel) must belong to
// one of the certificates supplied, or the application refuses to start. Accepts
// the plain hex, hex with colons, or the line OpenSSL prints ("...Fingerprint=AA:BB:...").
function checkPinnedFingerprint(pem, raw) {
  const expected = String(raw).split('=').pop().replace(/[:\s]/g, '').toUpperCase();
  if (!/^[0-9A-F]{64}$/.test(expected)) {
    throw new Error('Invalid configuration: DB_SSL_CA_SHA256 must be a SHA-256 fingerprint');
  }
  const blocks = pem.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g);
  const found = blocks.some(
    (block) => new X509Certificate(block).fingerprint256.replace(/:/g, '') === expected,
  );
  if (!found) {
    throw new Error('Invalid configuration: DB_SSL_CA does not match DB_SSL_CA_SHA256');
  }
}

// Certificate checking is never switched off. DB_SSL is "false" (the local
// development default, no TLS) or "true" (TLS, certificate checked against the
// public authorities); there is no setting that encrypts without checking.
//
// DB_SSL_CA (optional): the company's certificate. TLS is then on, the server's
// certificate must chain to it, and its name must match the server.
// DB_SSL_CA_SHA256 (optional, recommended with it): the certificate's SHA-256
// fingerprint as given by the company; a different certificate is refused.
// DB_SSL_SERVERNAME (optional): the name the certificate was issued for, when
// the connection uses an address the certificate does not list.
function parseDbSsl(env) {
  const mode = env.DB_SSL === undefined || env.DB_SSL === '' ? 'false' : env.DB_SSL;
  if (!['true', 'false'].includes(mode)) {
    throw new Error('Invalid configuration: DB_SSL must be true or false');
  }
  const servername = (env.DB_SSL_SERVERNAME ?? '').trim();
  if (servername && !/^[A-Za-z0-9._:-]{1,253}$/.test(servername)) {
    throw new Error('Invalid configuration: DB_SSL_SERVERNAME must be a host name or address');
  }
  const named = servername ? { servername } : {};

  if (env.DB_SSL_CA) {
    if (env.DB_SSL === 'false') {
      throw new Error('Invalid configuration: DB_SSL_CA needs DB_SSL=true (or DB_SSL unset)');
    }
    const ca = readCaCertificate(env.DB_SSL_CA);
    if (env.DB_SSL_CA_SHA256) checkPinnedFingerprint(ca, env.DB_SSL_CA_SHA256);
    return { ca, rejectUnauthorized: true, ...named };
  }
  if (env.DB_SSL_CA_SHA256) {
    throw new Error('Invalid configuration: DB_SSL_CA_SHA256 needs DB_SSL_CA');
  }
  if (mode === 'false') {
    if (servername) throw new Error('Invalid configuration: DB_SSL_SERVERNAME needs DB_SSL=true');
    return false;
  }
  return { rejectUnauthorized: true, ...named };
}

// Builds the application config from environment variables.
// Error messages name the variables only; values are never included.
export function loadConfig(env = process.env) {
  const missing = REQUIRED_DB_VARS.filter((name) => !env[name]);
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}. ` +
        'Copy .env.example to .env and fill in the values.',
    );
  }

  return Object.freeze({
    environment: env.NODE_ENV || 'development',
    host: env.HOST || '127.0.0.1',
    port: parsePort('PORT', env.PORT || '3000'),
    // Base address used in links sent to candidates (the Company CV upload link).
    publicBaseUrl: (env.PUBLIC_BASE_URL || `http://localhost:${env.PORT || '3000'}`).replace(
      /\/+$/,
      '',
    ),
    // 32-byte key (base64) that encrypts a stored company-account temporary
    // password. Never written to code or logs. Without it no password can be
    // stored or revealed.
    companySecretKey: env.COMPANY_SECRET_KEY || null,
    // Where the development storage adapter keeps uploaded files. This is a
    // development convenience, not the production storage architecture.
    devStorageDir: env.DEV_STORAGE_DIR || null,
    db: Object.freeze({
      host: env.DB_HOST,
      port: parsePort('DB_PORT', env.DB_PORT),
      database: env.DB_NAME,
      user: env.DB_USER,
      password: env.DB_PASSWORD,
      ssl: parseDbSsl(env),
    }),
  });
}
