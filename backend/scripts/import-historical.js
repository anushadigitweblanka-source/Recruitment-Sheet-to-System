// Historical interview log import. Run from the project root:
//
//   npm run import:historical -- "<file.csv>"                       dry run (default)
//   npm run import:historical -- "<file.csv>" --execute --confirm-sha <16+ hex> --backup "<dump file>"
//   npm run import:historical -- --rollback <batchId>
//
// The default is a dry run: the file is read and counted, the database is not
// touched. --execute writes only the two historical tables, in one
// transaction, and only when: the file fingerprint is confirmed, a recent
// non-empty backup file is named, and the database is a development database.
// Output is counts only - no name, phone or remark is ever printed.
//
// The historical tables come from migration 015. If a database does not have
// them yet, --execute and --rollback refuse.

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadConfig, loadEnvFile } from '../src/config/env.js';
import { createPool } from '../src/db/pool.js';
import {
  dryRun,
  executeImport,
  rollbackBatch,
  verifyBackup,
} from '../src/modules/historical/importer.js';
import { assertDevelopmentDatabase } from './devSafety.js';

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name) => {
  const at = args.indexOf(name);
  return at === -1 ? null : args[at + 1];
};
const positional = args.filter(
  (arg, i) =>
    !arg.startsWith('--') && !['--confirm-sha', '--backup', '--rollback'].includes(args[i - 1]),
)[0];

let pool;
try {
  if (flag('--rollback')) {
    loadEnvFile();
    const config = loadConfig();
    assertDevelopmentDatabase(config);
    pool = createPool(config.db);
    const result = await rollbackBatch(pool, Number(value('--rollback')));
    console.log(`Rolled back batch ${result.batchId}: ${result.removed} record(s) removed.`);
  } else {
    if (!positional) {
      console.error('Usage: npm run import:historical -- "<file.csv>" [--execute ...]');
      console.error('No file was given, so nothing was done.');
      process.exit(1);
    }
    const path = resolve(positional);
    if (!existsSync(path)) {
      console.error(`File not found: ${path}`);
      process.exit(1);
    }

    const plan = await dryRun(path);
    console.log(
      `File: ${plan.fileName}   fingerprint: ${plan.fingerprint}   encoding: ${plan.encoding}`,
    );
    console.log(
      `Records: ${plan.records}   clean: ${plan.clean}   needing review: ${plan.needingReview}   ` +
        `with a readable date: ${plan.withInterviewDate}`,
    );
    console.log('Review flags:', JSON.stringify(plan.flagCounts));

    if (!flag('--execute')) {
      console.log('Dry run only: nothing was written. Add --execute to import.');
    } else {
      const backup = value('--backup');
      if (!backup) {
        console.error('Refused: --backup <file> is required to import.');
        process.exit(1);
      }
      const info = verifyBackup(resolve(backup));
      console.log(
        `Backup file accepted: ${info.sizeBytes} bytes, ${info.modifiedAt.toISOString()}`,
      );

      loadEnvFile();
      const config = loadConfig();
      assertDevelopmentDatabase(config);
      pool = createPool(config.db);
      const result = await executeImport(pool, path, { confirmSha: value('--confirm-sha') });
      console.log(
        `Imported batch ${result.batchId}: ${result.imported} record(s), ${result.needingReview} need review.`,
      );
    }
  }
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
} finally {
  await pool?.end();
}
