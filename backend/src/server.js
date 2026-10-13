import { createApp } from './app.js';
import { loadConfig, loadEnvFile } from './config/env.js';
import { createPool } from './db/pool.js';

let config;
try {
  loadEnvFile();
  config = loadConfig();
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

const pool = createPool(config.db);
const app = createApp({ config, pool });

const server = app.listen(config.port, config.host, () => {
  console.log(`Backend listening on http://${config.host}:${config.port} (${config.environment})`);
});

function shutdown(signal) {
  console.log(`${signal} received, shutting down`);
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
