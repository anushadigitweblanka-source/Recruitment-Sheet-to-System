// The entry point Vercel runs for the backend service (see vercel.json). It
// builds the same Express app as server.js and exports it, but starts nothing
// else: no listener, no migrations, no imports, and no notification scheduler.
// The 15-minute reminder job needs a scheduler that has not been approved for
// this deployment, so reminders are not sent from here.
//
// Locally nothing changes: `npm run dev` and `npm start` still use server.js.
import { createApp } from './app.js';
import { loadConfig, loadEnvFile } from './config/env.js';
import { createPool } from './db/pool.js';

// On Vercel the settings come from the project's environment variables, so a
// missing .env file is normal (loadEnvFile only reads one if it exists).
loadEnvFile();
const config = loadConfig();

// The pool connects lazily, on the first query.
export default createApp({ config, pool: createPool(config.db) });
