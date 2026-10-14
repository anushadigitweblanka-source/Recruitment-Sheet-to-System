// Writes the dry-run report as Markdown under validation/import-dry-run/.
// PII-safe by construction: the report carries tab names, row numbers,
// Candidate IDs (the approved safe reference), issue codes and explanations.
// It never prints phone numbers, emails, names or addresses from the
// workbook - issue details are written by the validators without raw values.

import { mkdir, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

const STATUS_LINE = (t) =>
  `rows scanned: ${t.scanned} · ready: ${t.ready} · review required: ${t.review} · skipped: ${t.skipped}`;

export function renderReport(result, { generatedAt = new Date() } = {}) {
  const lines = [];
  lines.push(`# Import Dry-Run Report`);
  lines.push('');
  lines.push(`- Workbook: \`${basename(result.workbookPath)}\``);
  lines.push(`- Mode: **${result.mode}** (no recruitment data was written)`);
  lines.push(`- Generated: ${generatedAt.toISOString()}`);
  lines.push(`- Totals: ${STATUS_LINE(result.totals)}`);
  lines.push('');

  lines.push('## Issue summary');
  lines.push('');
  const codes = Object.keys(result.issueCounts).sort();
  if (codes.length === 0) {
    lines.push('No issues found.');
  } else {
    lines.push('| Issue code | Count |');
    lines.push('| --- | --- |');
    for (const code of codes) lines.push(`| ${code} | ${result.issueCounts[code]} |`);
  }
  lines.push('');

  for (const sheet of result.sheets) {
    lines.push(`## Sheet: ${sheet.name} (${sheet.areaLabel})`);
    lines.push('');
    lines.push(`Rows scanned: ${sheet.rowsScanned}`);
    lines.push('');
    if (sheet.structureIssues.length > 0) {
      lines.push('### Structure');
      lines.push('');
      for (const issue of sheet.structureIssues) {
        lines.push(`- \`${issue.code}\`: ${issue.detail}`);
      }
      lines.push('');
    }
    const flagged = sheet.rows.filter((row) => row.issues.length > 0);
    if (flagged.length > 0) {
      lines.push('### Rows needing review');
      lines.push('');
      lines.push('| Row | Candidate ID | Issue code | Explanation |');
      lines.push('| --- | --- | --- | --- |');
      for (const row of flagged) {
        for (const issue of row.issues) {
          lines.push(
            `| ${row.rowNumber} | ${row.safeRef ?? '—'} | ${issue.code} | ${issue.detail} |`,
          );
        }
      }
      lines.push('');
    }
  }

  lines.push('---');
  lines.push('');
  lines.push(
    'This was a **dry run**: no candidate, interview, offer, employee or notification was created, changed or deleted, and no email was sent.',
  );
  lines.push('');
  return lines.join('\n');
}

export async function writeReport(result, reportDir) {
  await mkdir(reportDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
  const name = basename(result.workbookPath).replace(/\.[^.]+$/, '');
  const path = join(reportDir, `${stamp}-${name}.md`);
  await writeFile(path, renderReport(result), 'utf8');
  return path;
}
