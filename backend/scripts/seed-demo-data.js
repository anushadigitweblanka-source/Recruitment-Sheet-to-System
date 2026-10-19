// Fills a SEPARATE hosted demo database with fictional data. It never touches
// real recruitment data and makes no change unless --apply is given.
//
//   node backend/scripts/seed-demo-data.js            dry run: checks and prints the plan
//   node backend/scripts/seed-demo-data.js --apply    writes the fictional data
//
// Set the DB_* variables for the demo database in your own terminal first (a
// local .env never overrides variables that are already set). For --apply also
// set DEMO_SUPERVISOR_PASSWORD (12+ characters, typed by you, never printed) and
// optionally DEMO_SUPERVISOR_EMAIL.
//
// Guards, all of which must pass:
//   - the database name is exactly recruitment_demo_dev (so never the real
//     recruitment_system_dev) and ends in _dev, and NODE_ENV is not production
//   - the host is not this computer, and the migrations are already applied
//   - there are no candidates, employees, offers, interviews or historical rows,
//     and neither seeded account exists yet
import { loadConfig, loadEnvFile } from '../src/config/env.js';
import { createPool } from '../src/db/pool.js';
import { MIN_PASSWORD_LENGTH } from '../src/modules/auth/passwords.js';
import {
  DEMO_DATABASE,
  PLAN,
  SEEDER_EMAIL,
  SUPERVISOR_ROLE,
  countExisting,
  seedDemoData,
} from './demoSeed.js';
import { assertDevelopmentDatabase } from './devSafety.js';

const LOCAL_HOSTS = ['localhost', '127.0.0.1', '::1', '0.0.0.0'];
const apply = process.argv.includes('--apply');

let pool;
try {
  loadEnvFile();
  const config = loadConfig();
  assertDevelopmentDatabase(config);
  if (config.db.database !== DEMO_DATABASE) {
    throw new Error(
      `Refusing to run: this seed only fills the database named "${DEMO_DATABASE}", not "${config.db.database}".`,
    );
  }
  if (LOCAL_HOSTS.includes(config.db.host.toLowerCase())) {
    throw new Error('Refusing to run: the demo database must be hosted, not on this computer.');
  }

  const supervisor = {
    fullName: 'Demo Supervisor',
    email: (process.env.DEMO_SUPERVISOR_EMAIL || 'supervisor.demo@example.test')
      .trim()
      .toLowerCase(),
    password: process.env.DEMO_SUPERVISOR_PASSWORD || '',
  };
  if (apply && supervisor.password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(
      `Set DEMO_SUPERVISOR_PASSWORD (at least ${MIN_PASSWORD_LENGTH} characters) in this terminal first.`,
    );
  }

  pool = createPool(config.db);
  const found = await pool.query('SELECT current_database() AS database, current_user AS "user"');
  console.log(
    `Database: ${found.rows[0].database}   User: ${found.rows[0].user}   Host: ${config.db.host}`,
  );

  const existing = await countExisting(pool).catch(() => {
    throw new Error(
      'The migrations have not been applied to this database yet. Nothing was changed.',
    );
  });
  console.log('Existing rows:', JSON.stringify(existing));
  const occupied = ['candidates', 'employees', 'offers', 'interviews', 'historicalRecords'].filter(
    (name) => existing[name] > 0,
  );
  if (occupied.length > 0) {
    throw new Error(`Refusing to run: this database already holds data (${occupied.join(', ')}).`);
  }
  const taken = await pool.query('SELECT email FROM users WHERE email = ANY($1)', [
    [SEEDER_EMAIL, supervisor.email],
  ]);
  if (taken.rowCount > 0) {
    throw new Error('Refusing to run: a seeded account already exists in this database.');
  }

  console.log('Plan:');
  for (const line of PLAN) console.log(`  ${line}`);
  console.log(`Supervisor: ${supervisor.email} (${SUPERVISOR_ROLE} role)`);

  if (!apply) {
    console.log('Dry run only: nothing was changed. Add --apply to write the fictional data.');
  } else {
    await seedDemoData({ pool, config, supervisor, log: (message) => console.log(message) });
    console.log(
      'Done. The supervisor password was not printed or stored anywhere but the database (hashed).',
    );
  }
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
} finally {
  await pool?.end();
}
