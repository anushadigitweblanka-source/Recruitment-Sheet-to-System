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

// DB_SSL: unset or "false" = no TLS (the local development default); "true" =
// TLS with the server certificate checked (what a hosted database needs);
// "no-verify" = TLS without checking the certificate (less safe; only for a
// provider that cannot be verified).
function parseDbSsl(value) {
  if (value === undefined || value === '' || value === 'false') return false;
  if (value === 'true') return { rejectUnauthorized: true };
  if (value === 'no-verify') return { rejectUnauthorized: false };
  throw new Error('Invalid configuration: DB_SSL must be true, false or no-verify');
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
      ssl: parseDbSsl(env.DB_SSL),
    }),
  });
}
