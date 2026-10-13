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
    db: Object.freeze({
      host: env.DB_HOST,
      port: parsePort('DB_PORT', env.DB_PORT),
      database: env.DB_NAME,
      user: env.DB_USER,
      password: env.DB_PASSWORD,
    }),
  });
}
