// Reads a .csv file into the same plain sheet shape as workbook.js, so the
// dry-run treats a CSV export exactly like a workbook tab. Nothing is
// interpreted here and nothing is repaired.
//
// What the real recruitment CSV needs (see validation/real-csv-mapping-review.md):
//   - Windows-1252 text, not UTF-8 (decoded without guessing: UTF-8 is tried
//     strictly first, and only invalid UTF-8 is read as Windows-1252),
//   - CRLF line endings,
//   - quoted cells that contain line breaks (a record is not a text line),
//   - columns with a blank header that are empty in every row.
//
// Row numbers are record numbers: the header is record 1, so a report can
// point at the record even when a cell spans several text lines.

import { readFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';

// Decodes file bytes. A UTF-8 byte order mark is dropped.
export function decodeCsv(buffer) {
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    const stripped = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
    return { text: stripped, encoding: 'utf-8' };
  } catch {
    return { text: new TextDecoder('windows-1252').decode(buffer), encoding: 'windows-1252' };
  }
}

// RFC 4180 parsing: "" inside quotes is a quote; CR, LF and CRLF end a record
// outside quotes; a record of one empty cell (a blank line) is kept so the
// numbering stays honest and is dropped later.
export function parseCsv(text) {
  const records = [];
  let record = [];
  let cell = '';
  let inQuotes = false;
  let i = 0;

  const endCell = () => {
    record.push(cell);
    cell = '';
  };
  const endRecord = () => {
    endCell();
    records.push(record);
    record = [];
  };

  while (i < text.length) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
      } else {
        cell += char;
      }
    } else if (char === '"' && cell === '') {
      inQuotes = true;
    } else if (char === ',') {
      endCell();
    } else if (char === '\r') {
      endRecord();
      if (text[i + 1] === '\n') i += 1;
    } else if (char === '\n') {
      endRecord();
    } else {
      cell += char;
    }
    i += 1;
  }
  // A final record with no trailing line break.
  if (cell !== '' || record.length > 0) endRecord();
  return records;
}

const isEmptyRecord = (record) => record.every((cell) => cell.trim() === '');

// Returns { name, headers, headerIssues, rows, meta }.
export async function readCsvSheet(path) {
  const { text, encoding } = decodeCsv(await readFile(path));
  const records = parseCsv(text);
  const meta = { encoding, records: Math.max(records.length - 1, 0), columns: 0, emptyColumns: 0 };
  if (records.length === 0) {
    return { name: basename(path, extname(path)), headers: [], headerIssues: [], rows: [], meta };
  }

  const headerRecord = records[0];
  const width = Math.max(...records.map((r) => r.length));
  meta.columns = width;

  // A column with no header and no value anywhere is not data at all.
  const dataRecords = records.slice(1);
  const columnIsEmpty = (col) =>
    dataRecords.every((r) => (r[col] ?? '').trim() === '') &&
    (headerRecord[col] ?? '').trim() === '';

  const headers = [];
  const headerIssues = [];
  const seen = new Set();
  for (let col = 0; col < width; col += 1) {
    const name = (headerRecord[col] ?? '').trim();
    if (columnIsEmpty(col)) {
      meta.emptyColumns += 1;
      continue;
    }
    if (!name) {
      headerIssues.push({
        code: 'unknown_header',
        detail: `column ${col + 1} has a blank header but holds values`,
      });
      headers.push({ col, name: `(blank column ${col + 1})` });
      continue;
    }
    if (seen.has(name.toLowerCase())) {
      headerIssues.push({ code: 'unknown_header', detail: `duplicate header "${name}"` });
    }
    seen.add(name.toLowerCase());
    headers.push({ col, name });
  }

  const rows = [];
  records.forEach((record, index) => {
    if (index === 0 || isEmptyRecord(record)) return;
    const values = {};
    for (const { col, name } of headers) {
      const raw = record[col];
      values[name] = raw === undefined || raw.trim() === '' ? null : raw;
    }
    rows.push({ rowNumber: index + 1, values });
  });

  return {
    name: basename(path, extname(path)),
    headers: headers.map((h) => h.name),
    headerIssues,
    rows,
    meta,
  };
}
