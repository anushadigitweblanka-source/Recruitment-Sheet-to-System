// Exports for the seven reports, in three formats. The datasets come from the
// SAME repository functions and filter parsers as the on-screen reports, so an
// exported file always matches the filtered screen - there is no separate
// business logic here, only column definitions and format rendering.
//
// Nothing restricted can appear: the columns below are exactly the fields the
// screen already shows (no salary - none exists - and no credentials).

import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import {
  candidateStatusReport,
  exitReport,
  funnelReport,
  onboardingReport,
  positionReport,
  sourceReport,
  weeklyReport,
} from './reports.repository.js';
import { parseRangeQuery, parseStatusQuery, parseWeeklyQuery } from './reports.validation.js';

// An export is the whole filtered result, not one page. The cap only guards
// against a runaway file; the development data is nowhere near it.
const EXPORT_ROW_LIMIT = 10000;

// Dates in files are office-calendar dates, like the screen.
const DATE = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  timeZone: 'Asia/Colombo',
});
const DATE_TIME = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZone: 'Asia/Colombo',
});
const date = (value) => (value ? DATE.format(new Date(value)) : '');
const dateTime = (value) => (value ? DATE_TIME.format(new Date(value)) : '');

const PHASE_LABELS = {
  evaluation: 'Evaluation',
  probation: 'Probation',
  junior: 'Junior',
  senior: 'Senior',
};
const STATUS_LABELS = { active: 'Active', discontinued: 'Discontinued', terminated: 'Terminated' };

const usedFilters = (pairs) =>
  pairs.filter(([, value]) => value).map(([label, value]) => `${label}: ${value}`);

// Each builder returns { title, filters: [text], columns: [{key, label, width}], rows }.
const BUILDERS = {
  'candidate-status': async (pool, query) => {
    const filters = parseStatusQuery(query);
    const { items } = await candidateStatusReport(pool, {
      ...filters,
      page: 1,
      pageSize: EXPORT_ROW_LIMIT,
    });
    return {
      title: 'Candidate Status Report',
      filters: usedFilters([
        ['Stage', filters.stage],
        ['Position ID', filters.positionId],
        ['Source ID', filters.sourceId],
        ['Added from', filters.from],
        ['Added to', filters.to],
      ]),
      columns: [
        { key: 'candidateCode', label: 'Candidate ID', width: 16 },
        { key: 'fullName', label: 'Name', width: 28 },
        { key: 'position', label: 'Position', width: 24 },
        { key: 'source', label: 'Source', width: 18 },
        { key: 'stageName', label: 'Current Stage', width: 20 },
        { key: 'stageChangedAt', label: 'Stage Since', width: 20 },
        { key: 'createdAt', label: 'Added', width: 14 },
      ],
      rows: items.map((row) => ({
        candidateCode: row.candidateCode,
        fullName: row.fullName,
        position: row.position ?? '',
        source: row.source ?? '',
        stageName: row.stageName ?? row.stage,
        stageChangedAt: dateTime(row.stageChangedAt),
        createdAt: date(row.createdAt),
      })),
    };
  },

  funnel: async (pool, query) => {
    const range = parseRangeQuery(query);
    const stages = await funnelReport(pool, range);
    return {
      title: 'Funnel Report',
      filters: usedFilters([
        ['Movement from', range.from],
        ['Movement to', range.to],
      ]),
      columns: [
        { key: 'stageName', label: 'Stage', width: 24 },
        { key: 'current', label: 'Candidates There Now', width: 22 },
        { key: 'entered', label: 'Entered During Period', width: 22 },
      ],
      rows: stages,
    };
  },

  sources: async (pool) => ({
    title: 'Source Report',
    filters: [],
    columns: breakdownColumns('Source'),
    rows: await sourceReport(pool),
  }),

  positions: async (pool) => ({
    title: 'Position Report',
    filters: [],
    columns: breakdownColumns('Position'),
    rows: await positionReport(pool),
  }),

  weekly: async (pool, query) => {
    const week = parseWeeklyQuery(query);
    const data = await weeklyReport(pool, week);
    return {
      title: 'Weekly Recruitment Report',
      filters: [
        `Week: ${date(data.weekStart)} to ${date(data.weekEnd)} (Asia/Colombo, Monday to Sunday)`,
      ],
      columns: [
        { key: 'metric', label: 'Metric', width: 34 },
        { key: 'value', label: 'Value', width: 12 },
      ],
      rows: [
        { metric: 'Applications (candidates added)', value: data.applications },
        { metric: 'Offers Sent', value: data.offersSent },
        { metric: 'Offers Accepted', value: data.offersAccepted },
        { metric: 'Joined', value: data.joined },
        { metric: 'Rejected', value: data.rejected },
        ...data.movements.map((row) => ({
          metric: `Moved to ${row.stageName ?? row.stage}`,
          value: row.total,
        })),
      ],
    };
  },

  onboarding: async (pool, query) => {
    const range = parseRangeQuery(query);
    const items = await onboardingReport(pool, range);
    return {
      title: 'Onboarding Report',
      filters: usedFilters([
        ['Joined from', range.from],
        ['Joined to', range.to],
      ]),
      columns: [
        { key: 'candidateCode', label: 'Candidate ID', width: 16 },
        { key: 'fullName', label: 'Employee', width: 28 },
        { key: 'position', label: 'Position', width: 24 },
        { key: 'joinDate', label: 'Join Date', width: 14 },
        { key: 'track', label: 'Track', width: 12 },
        { key: 'currentPhase', label: 'Current Phase', width: 16 },
        { key: 'status', label: 'Status', width: 14 },
      ],
      rows: items.map((row) => ({
        candidateCode: row.candidateCode,
        fullName: row.fullName,
        position: row.position ?? '',
        joinDate: date(row.joinDate),
        track: row.track ?? '',
        currentPhase: PHASE_LABELS[row.currentPhase] ?? row.currentPhase,
        status: STATUS_LABELS[row.status] ?? row.status,
      })),
    };
  },

  exit: async (pool, query) => {
    const range = parseRangeQuery(query);
    const items = await exitReport(pool, range);
    return {
      title: 'Exit Report',
      filters: usedFilters([
        ['Exit from', range.from],
        ['Exit to', range.to],
      ]),
      columns: [
        { key: 'candidateCode', label: 'Candidate ID', width: 16 },
        { key: 'fullName', label: 'Employee', width: 28 },
        { key: 'position', label: 'Position', width: 24 },
        { key: 'joinDate', label: 'Join Date', width: 14 },
        { key: 'status', label: 'Exit Type', width: 16 },
        { key: 'exitDate', label: 'Exit Date', width: 14 },
        { key: 'exitReason', label: 'Reason', width: 40 },
      ],
      rows: items.map((row) => ({
        candidateCode: row.candidateCode,
        fullName: row.fullName,
        position: row.position ?? '',
        joinDate: date(row.joinDate),
        status: STATUS_LABELS[row.status] ?? row.status,
        exitDate: date(row.exitDate),
        exitReason: row.exitReason ?? '',
      })),
    };
  },
};

function breakdownColumns(nameLabel) {
  return [
    { key: 'name', label: nameLabel, width: 26 },
    { key: 'total', label: 'Candidates', width: 12 },
    { key: 'inProgress', label: 'In Progress', width: 12 },
    { key: 'hired', label: 'Joined', width: 10 },
    { key: 'rejected', label: 'Rejected', width: 10 },
    { key: 'onHold', label: 'On Hold', width: 10 },
    { key: 'unresponsive', label: 'No Show / No Response', width: 22 },
  ];
}

export const EXPORT_REPORTS = Object.keys(BUILDERS);
export const EXPORT_FORMATS = ['xlsx', 'csv', 'pdf'];

export async function buildExportData(pool, report, query) {
  const builder = BUILDERS[report];
  if (!builder) return null;
  const data = await builder(pool, query);
  data.generatedAt = new Date();
  return data;
}

export function exportFilename(report, format, now = new Date()) {
  const day = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Colombo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  return `${report}-${day}.${format}`;
}

// ---------------------------------------------------------------------------
// Excel
// ---------------------------------------------------------------------------

export async function renderXlsx(data) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(data.title.slice(0, 31));

  sheet.addRow([data.title]).font = { bold: true, size: 14 };
  sheet.addRow([`Generated: ${dateTime(data.generatedAt)} (Asia/Colombo)`]);
  for (const line of data.filters) sheet.addRow([`Filter - ${line}`]);
  sheet.addRow([]);

  const header = sheet.addRow(data.columns.map((column) => column.label));
  header.font = { bold: true };
  data.columns.forEach((column, index) => {
    sheet.getColumn(index + 1).width = column.width ?? 18;
  });

  for (const row of data.rows) {
    sheet.addRow(data.columns.map((column) => row[column.key] ?? ''));
  }

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

// ---------------------------------------------------------------------------
// CSV (UTF-8 with a BOM so spreadsheets read the encoding correctly)
// ---------------------------------------------------------------------------

function csvCell(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function renderCsv(data) {
  const lines = [data.columns.map((column) => csvCell(column.label)).join(',')];
  for (const row of data.rows) {
    lines.push(data.columns.map((column) => csvCell(row[column.key])).join(','));
  }
  // The leading \uFEFF is the UTF-8 BOM, so Excel opens the CSV as UTF-8.
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

// ---------------------------------------------------------------------------
// PDF (plain, functional table; landscape for wide reports)
// ---------------------------------------------------------------------------

export function renderPdf(data) {
  return new Promise((resolve, reject) => {
    const wide = data.columns.length > 4;
    const doc = new PDFDocument({
      size: 'A4',
      layout: wide ? 'landscape' : 'portrait',
      margin: 36,
      bufferPages: true,
    });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('error', reject);
    doc.on('end', () => resolve(Buffer.concat(chunks)));

    const pageWidth = doc.page.width - 72;
    const totalWidth = data.columns.reduce((sum, column) => sum + (column.width ?? 18), 0);
    const widths = data.columns.map((column) => ((column.width ?? 18) / totalWidth) * pageWidth);
    const rowBottom = () => doc.page.height - 48;

    doc.fontSize(14).font('Helvetica-Bold').text('Recruitment System');
    doc.fontSize(12).text(data.title);
    doc
      .fontSize(9)
      .font('Helvetica')
      .text(`Generated: ${dateTime(data.generatedAt)} (Asia/Colombo)`);
    for (const line of data.filters) doc.text(`Filter - ${line}`);
    doc.moveDown(0.8);

    const drawRow = (values, bold) => {
      const height =
        Math.max(
          ...values.map((text, index) =>
            doc.heightOfString(String(text ?? ''), { width: widths[index] - 6 }),
          ),
          10,
        ) + 6;
      if (doc.y + height > rowBottom()) {
        doc.addPage();
        drawRow(
          data.columns.map((column) => column.label),
          true,
        );
      }
      const y = doc.y;
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9);
      let x = 36;
      values.forEach((text, index) => {
        doc.text(String(text ?? ''), x + 3, y + 3, { width: widths[index] - 6 });
        x += widths[index];
      });
      doc
        .moveTo(36, y + height)
        .lineTo(36 + pageWidth, y + height)
        .strokeColor('#999999')
        .lineWidth(0.5)
        .stroke();
      doc.x = 36;
      doc.y = y + height;
    };

    drawRow(
      data.columns.map((column) => column.label),
      true,
    );
    for (const row of data.rows) {
      drawRow(
        data.columns.map((column) => row[column.key]),
        false,
      );
    }
    if (data.rows.length === 0) {
      doc.moveDown(0.5).font('Helvetica').fontSize(10).text('No rows match the chosen filters.');
    }

    // Page numbers.
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i += 1) {
      doc.switchToPage(i);
      doc
        .font('Helvetica')
        .fontSize(8)
        .text(`Page ${i + 1} of ${range.count}`, 36, doc.page.height - 36, {
          width: pageWidth,
          align: 'right',
        });
    }
    doc.end();
  });
}

export const RENDERERS = {
  xlsx: {
    render: renderXlsx,
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  },
  csv: { render: async (data) => renderCsv(data), contentType: 'text/csv; charset=utf-8' },
  pdf: { render: renderPdf, contentType: 'application/pdf' },
};
