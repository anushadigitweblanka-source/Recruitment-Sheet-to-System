// Dry-run workbook validation. Run from the project root:
//
//   npm run import:dry-run -- "C:\path\Recruitment.xlsx"
//
// Reads the workbook, validates it against the data maps and the existing
// database (read-only), writes a PII-safe report under
// validation/import-dry-run/ and prints a summary. It NEVER writes
// recruitment data: the database handle refuses anything but SELECT.

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadConfig, loadEnvFile } from '../src/config/env.js';
import { createPool } from '../src/db/pool.js';
import { runDryRun } from '../src/import/dryRun.js';
import { writeReport } from '../src/import/report.js';
import { assertDevelopmentDatabase } from './devSafety.js';

const workbookArg = process.argv[2];
if (!workbookArg) {
  console.error('Usage: npm run import:dry-run -- "<path to workbook.xlsx>"');
  console.error('No workbook was given, so nothing was done.');
  process.exit(1);
}

const workbookPath = resolve(workbookArg);
if (!existsSync(workbookPath)) {
  console.error(`Workbook not found: ${workbookPath}`);
  process.exit(1);
}

let pool;
try {
  loadEnvFile();
  const config = loadConfig();
  assertDevelopmentDatabase(config);
  pool = createPool(config.db);

  console.log(`Workbook detected: ${workbookPath}`);
  console.log('Mode: dry-run (no recruitment data is written)');

  const result = await runDryRun(pool, workbookPath);

  for (const sheet of result.sheets) {
    console.log(
      `Sheet "${sheet.name}" → ${sheet.areaLabel}: ${sheet.rowsScanned} row(s), ` +
        `${sheet.rows.filter((r) => r.status === 'REVIEW_REQUIRED').length} need review`,
    );
  }
  console.log(
    `Totals: ${result.totals.scanned} scanned, ${result.totals.ready} ready, ` +
      `${result.totals.review} review required, ${result.totals.skipped} skipped`,
  );

  const reportDir = resolve(import.meta.dirname, '../../validation/import-dry-run');
  const reportPath = await writeReport(result, reportDir);
  console.log(`Report written: ${reportPath}`);
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
} finally {
  await pool?.end();
}
