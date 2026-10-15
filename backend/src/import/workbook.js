// Reads an .xlsx workbook into plain data: sheet names, headers and rows.
// Nothing is interpreted here; interpretation belongs to the validators.

import { extname } from 'node:path';
import ExcelJS from 'exceljs';
import { readCsvSheet } from './csv.js';

// A cell as a plain value: strings, numbers, booleans and Dates pass through;
// formula cells give their last calculated result; rich text is flattened.
function plainValue(cell) {
  const v = cell.value;
  if (v === null || v === undefined) return null;
  if (v instanceof Date || typeof v !== 'object') return v;
  if (v.richText) return v.richText.map((part) => part.text).join('');
  if (v.hyperlink) return v.text ?? v.hyperlink;
  if (v.formula !== undefined) return v.result ?? null;
  if (v.error) return null;
  return String(v);
}

// Returns [{ name, headers, headerIssues, rows }] where each row is
// { rowNumber, values: { headerName: value } }. Row numbers are the real
// workbook row numbers (header row is row 1), so a report can point at the
// exact row. Duplicate and blank headers are reported, not repaired.
export async function readWorkbook(path) {
  // A CSV export is one flat sheet; it goes through the same validation.
  if (extname(path).toLowerCase() === '.csv') return [await readCsvSheet(path)];

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(path);

  const sheets = [];
  workbook.eachSheet((sheet) => {
    const headerRow = sheet.getRow(1);
    const headers = [];
    const headerIssues = [];
    const seen = new Set();

    headerRow.eachCell({ includeEmpty: true }, (cell, col) => {
      const raw = plainValue(cell);
      const name = raw === null ? '' : String(raw).trim();
      if (!name) {
        headerIssues.push({ code: 'unknown_header', detail: `column ${col} has a blank header` });
        headers.push({ col, name: `(blank column ${col})` });
        return;
      }
      if (seen.has(name.toLowerCase())) {
        headerIssues.push({ code: 'unknown_header', detail: `duplicate header "${name}"` });
      }
      seen.add(name.toLowerCase());
      headers.push({ col, name });
    });

    const rows = [];
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      const values = {};
      let hasValue = false;
      for (const { col, name } of headers) {
        const value = plainValue(row.getCell(col));
        values[name] = value;
        if (value !== null && String(value).trim() !== '') hasValue = true;
      }
      if (hasValue) rows.push({ rowNumber, values });
    });

    sheets.push({ name: sheet.name, headers: headers.map((h) => h.name), headerIssues, rows });
  });

  return sheets;
}
