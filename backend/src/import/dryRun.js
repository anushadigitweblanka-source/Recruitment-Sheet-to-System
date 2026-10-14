// The dry-run orchestrator: reads a workbook, validates every sheet and row
// against the data maps and the existing database (read-only), and returns a
// full result for the report. It never writes a business table - the db
// handle it uses is wrapped by readOnlyDb, which throws on anything but a
// plain SELECT.

import { detectArea, FORBIDDEN_HEADERS, mapHeaders } from './expectedStructure.js';
import { loadApprovedMappings } from './approvedMappings.js';
import { readOnlyDb } from './readOnlyDb.js';
import { readWorkbook } from './workbook.js';
import { REVIEW_REQUIRED, VALIDATORS } from './validateRows.js';

// Active lookup rows, read-only; workbook spellings resolve against the
// lowercased name. (The position-alias merge table is a future migration;
// until then only exact names of approved lookup rows resolve.)
async function loadLookupMap(db, table) {
  const { rows } = await db.query(`SELECT id, name FROM ${table} WHERE is_active = true`);
  const map = {};
  for (const row of rows) map[row.name.toLowerCase()] = Number(row.id);
  return map;
}

export async function runDryRun(pool, workbookPath, { approvedMappings } = {}) {
  const db = readOnlyDb(pool);
  const statusMaps = { ...loadApprovedMappings(), ...(approvedMappings ?? {}) };

  const ctx = {
    db,
    statusMaps,
    positionMap: await loadLookupMap(db, 'positions'),
    sourceMap: await loadLookupMap(db, 'sources'),
    seen: { candidateIds: new Map(), phoneKeys: new Map(), emails: new Map(), cvUrls: new Map() },
    rowNumber: 0,
  };

  const sheets = await readWorkbook(workbookPath);
  const result = { mode: db.mode, workbookPath, sheets: [], issueCounts: {}, totals: null };

  const count = (code) => {
    result.issueCounts[code] = (result.issueCounts[code] ?? 0) + 1;
  };

  for (const sheet of sheets) {
    const detected = detectArea(sheet.headers);
    const sheetResult = {
      name: sheet.name,
      area: detected?.area.key ?? null,
      areaLabel: detected?.area.label ?? 'unknown',
      rowsScanned: sheet.rows.length,
      structureIssues: [...sheet.headerIssues],
      unknownHeaders: [],
      rows: [],
    };
    sheetResult.structureIssues.forEach((issue) => count(issue.code));

    for (const header of sheet.headers) {
      for (const forbidden of FORBIDDEN_HEADERS) {
        if (forbidden.match.test(header)) {
          sheetResult.structureIssues.push({
            code: forbidden.code,
            detail: `header "${header}" looks like salary data, which is never imported (mentor approval required)`,
          });
          count(forbidden.code);
        }
      }
    }

    if (!detected) {
      // An unrecognized sheet is reviewed, never imported and never a reason
      // to fail the whole run.
      sheetResult.structureIssues.push({
        code: 'unknown_sheet',
        detail: 'headers match no area of the data map; every row needs review',
      });
      count('unknown_sheet');
      sheetResult.rows = sheet.rows.map((row) => ({
        rowNumber: row.rowNumber,
        status: REVIEW_REQUIRED,
        safeRef: null,
        issues: [{ code: 'unknown_sheet', detail: 'row belongs to an unrecognized sheet' }],
      }));
      sheetResult.rows.forEach(() => count('unknown_sheet'));
      result.sheets.push(sheetResult);
      continue;
    }

    const { fieldToHeader, unknownHeaders, missingRequired } = mapHeaders(
      detected.area,
      sheet.headers,
    );
    sheetResult.unknownHeaders = unknownHeaders;
    unknownHeaders.forEach((header) => {
      sheetResult.structureIssues.push({
        code: 'unknown_header',
        detail: `header "${header}" is not in the data map; its values are not validated`,
      });
      count('unknown_header');
    });
    missingRequired.forEach((field) => {
      sheetResult.structureIssues.push({
        code: 'missing_required_field',
        detail: `no header maps to the required field "${field}"`,
      });
      count('missing_required_field');
    });

    const validate = VALIDATORS[detected.area.key];
    for (const row of sheet.rows) {
      ctx.rowNumber = row.rowNumber;
      const values = {};
      for (const [field, header] of Object.entries(fieldToHeader)) {
        values[field] = row.values[header];
      }
      const rowResult = await validate(values, ctx);
      rowResult.issues.forEach((issue) => count(issue.code));
      sheetResult.rows.push({
        rowNumber: row.rowNumber,
        status: rowResult.status,
        safeRef: rowResult.safeRef ?? null,
        issues: rowResult.issues,
      });
    }

    result.sheets.push(sheetResult);
  }

  const totals = { scanned: 0, ready: 0, review: 0, skipped: 0 };
  for (const sheet of result.sheets) {
    totals.scanned += sheet.rowsScanned;
    for (const row of sheet.rows) {
      if (row.status === 'READY') totals.ready += 1;
      else if (row.status === 'REVIEW_REQUIRED') totals.review += 1;
      else totals.skipped += 1;
    }
  }
  result.totals = totals;
  return result;
}
