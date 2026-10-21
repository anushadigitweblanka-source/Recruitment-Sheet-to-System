// Builds fictional CV files in memory for extraction tests. Every person,
// phone number, address and email here is made up (example.test emails,
// 070-0000 numbers, "Fictional" places). No real CV or candidate is used and
// nothing is written to disk or to a database.

import PDFDocument from 'pdfkit';
import JSZip from 'jszip';

// Lines of plain text -> a PDF file (one text line per line given).
export function buildPdf(lines, { pages = 1 } = {}) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.fontSize(11);
    for (let page = 0; page < pages; page += 1) {
      if (page > 0) doc.addPage();
      for (const line of lines) doc.text(line === '' ? ' ' : line);
    }
    doc.end();
  });
}

const escapeXml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Lines of plain text -> a minimal valid .docx file (one paragraph per line).
export async function buildDocx(lines) {
  const body = lines
    .map((l) => `<w:p><w:r><w:t xml:space="preserve">${escapeXml(l)}</w:t></w:r></w:p>`)
    .join('');
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  );
  zip.file(
    '_rels/.rels',
    '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  );
  zip.file(
    'word/document.xml',
    `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`,
  );
  return zip.generateAsync({ type: 'nodebuffer' });
}

// A complete, well-labelled CV.
export const FULL_CV = [
  'Curriculum Vitae',
  'Name: Nimali Testperson',
  'Phone: 070 000 0001',
  'Email: nimali.testperson@example.test',
  'Address: 12 Fictional Lane,',
  'Examplepura, Testland',
  '',
  'Education',
  'G.C.E. Ordinary Level (2018) - Fictional College',
  'Mathematics: A, Science: B, English: C',
  '',
  'G.C.E. Advanced Level (2021) - Fictional College',
  'Stream: Physical Science',
  'Results: 2 Credits and 1 Pass',
  '',
  'BSc in Imaginary Computing, Fictional University (2022 - 2026)',
  'Diploma in Dummy Web Design, Example Institute',
  '',
  'Skills',
  'Pretend programming, imaginary databases',
  '',
  'Experience',
  'Intern at Fictional Works (2025)',
];

// A sparse CV: only a name line and an email, no labels, no education.
export const SPARSE_CV = [
  'Kasun Dummyman',
  'kasun.dummyman@example.test',
  'Looking for an internship in a fictional company.',
];

// Two phones and two emails, and a number that is a year range.
export const AMBIGUOUS_CV = [
  'Name: Sam Ambiguous',
  'Mobile: 070-000-0002',
  'Tel: +94 70 000 0003',
  'Email: sam.one@example.test',
  'Alt email: sam.two@example.test',
  'Studied 2019 - 2022 at a fictional place.',
];
