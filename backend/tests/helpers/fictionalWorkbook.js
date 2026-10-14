// Builds a fictional recruitment workbook for tests, written to a temporary
// file. Every value is obviously fake: example.test emails, made-up names,
// impossible-prefix phone numbers and dummy positions. No real candidate
// data, and nothing from the development database (candidates 2002/2003 are
// never referenced).

import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ExcelJS from 'exceljs';

export const FAKE = {
  positions: ['Dummy Automation Tester', 'Dummy Web Developer'],
  sources: ['Fictional Job Board'],
};

// Default sheets exercise both the happy path and every review path. Tests
// can pass their own `sheets` to build targeted workbooks.
export function defaultSheets() {
  return [
    {
      name: 'Candidates',
      headers: [
        'Candidate ID',
        'Name',
        'Phone',
        'Email',
        'Address',
        'O/L Maths',
        'A/L Result',
        'A/L Stream',
        'Other Education',
        'Applied Position',
        'CV Link',
        'Company CV Link',
        'Company CV Status',
        'Source',
        'HR Comment',
      ],
      rows: [
        // Clean row: everything resolvable.
        [
          'FAKE-0001',
          'Testy Example',
          '0770000001',
          'testy@example.test',
          '1 Fake Street',
          'A',
          '3 passes',
          'Maths',
          '',
          'Dummy Automation Tester',
          'https://cv.example.test/fake-0001',
          '',
          '',
          'Fictional Job Board',
          'fictional row',
        ],
        // Unknown position and source; phone stored as a number (Excel-style).
        [
          'FAKE-0002',
          'Secondo Example',
          771234500,
          'secondo@example.test',
          '',
          '',
          '',
          '',
          '',
          'Unknown Dummy Position',
          'https://cv.example.test/fake-0002',
          '',
          '',
          'Unknown Dummy Source',
          '',
        ],
        // Duplicate candidate ID (same as row 2) and reused CV link (row 1's).
        [
          'FAKE-0001',
          'Testy Duplicate',
          '0770000003',
          'dup@example.test',
          '',
          '',
          '',
          '',
          '',
          'Dummy Automation Tester',
          'https://cv.example.test/fake-0001',
          '',
          '',
          '',
          '',
        ],
        // Missing Candidate ID and bad email.
        [
          '',
          'Quarto Example',
          '0770000004',
          'not-an-email',
          '',
          '',
          '',
          '',
          '',
          'Dummy Web Developer',
          '',
          '',
          '',
          '',
          '',
        ],
      ],
    },
    {
      name: 'Phone Screening',
      headers: ['Candidate ID', 'Called', 'Response', 'Result', 'Review', 'Interview Date'],
      rows: [
        ['FAKE-0001', 'Yes', 'Will attend', 'Selected', 'fine', '2026-11-02T10:00:00+05:30'],
        // Row without ID: matched (or not) by phone/name - here unmatched.
        ['', 'No', '', '', '', ''],
      ],
    },
    {
      name: 'Direct Interviews',
      headers: [
        'Candidate ID',
        'Interview Date',
        'Attendance',
        'Interviewer',
        'Technical',
        'AI',
        'Communication',
        'Confidence',
        'Culture Fit',
        'Total',
        'Decision',
        'Remarks',
      ],
      rows: [
        // Total 39 does not match sum 40 → review; scores valid.
        [
          'FAKE-0001',
          '2026-11-03T10:00:00+05:30',
          'Attended',
          'Fake Interviewer',
          8,
          8,
          8,
          8,
          8,
          39,
          'Selected',
          '',
        ],
        // Score out of range and partial scores.
        ['FAKE-0002', '2026-11-04T10:00:00+05:30', '', '', 11, 5, '', '', '', '', '', ''],
      ],
    },
    {
      name: 'Offers',
      headers: [
        'Candidate ID',
        'Position',
        'Offer Date',
        'Work Mode',
        'Location',
        'Offer Status',
        'Onboarding Date',
        'Attended',
      ],
      rows: [
        [
          'FAKE-0001',
          'Dummy Automation Tester',
          '2026-11-10',
          'Office',
          'Fake City',
          'Sent',
          '2026-12-01',
          'No',
        ],
        // Ambiguous date text → review.
        ['FAKE-0002', 'Dummy Web Developer', '03/04/2026', '', '', '', '', ''],
      ],
    },
    {
      name: 'Employees',
      headers: [
        'Candidate ID',
        'Join Date',
        'Track',
        'Current Phase',
        'Phase Start',
        'Phase End',
        'Status',
      ],
      rows: [
        // References the fictional candidate the tests seed into the test
        // schema (never 2002/2003), so the match path is exercised.
        ['FAKE-EXISTING', '2026-01-05', 'Intern', 'Evaluation', '2026-01-05', '', 'Active'],
      ],
    },
    {
      name: 'Random Notes',
      headers: ['Something', 'Else'],
      rows: [['just', 'text']],
    },
  ];
}

export async function buildFictionalWorkbook({ sheets = defaultSheets(), fileName } = {}) {
  const workbook = new ExcelJS.Workbook();
  for (const sheet of sheets) {
    const ws = workbook.addWorksheet(sheet.name);
    ws.addRow(sheet.headers);
    for (const row of sheet.rows) ws.addRow(row);
  }
  const dir = await mkdtemp(join(tmpdir(), 'fictional-workbook-'));
  const path = join(dir, fileName ?? 'fictional-recruitment.xlsx');
  await workbook.xlsx.writeFile(path);
  return path;
}
