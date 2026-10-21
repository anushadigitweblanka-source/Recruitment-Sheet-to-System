// Builds fictional CV files in memory for extraction tests. Every person,
// phone number, address and email here is made up (example.test emails,
// 070-0000 numbers, "Fictional" places). No real CV or candidate is used and
// nothing is written to disk or to a database.

import PDFDocument from 'pdfkit';
import JSZip from 'jszip';

// Lines of plain text -> a PDF file (one text line per line given).
export function buildPdf(lines, { pages = 1, links = [] } = {}) {
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
    // Clickable words whose address is not in the text of the page.
    links.forEach((url, i) =>
      doc.fillColor('blue').text(`Link ${i + 1}`, { link: url, underline: true }),
    );
    doc.end();
  });
}

const escapeXml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Lines of plain text -> a minimal valid .docx file (one paragraph per line).
export async function buildDocx(lines, links = []) {
  const body = lines
    .map((l) => `<w:p><w:r><w:t xml:space="preserve">${escapeXml(l)}</w:t></w:r></w:p>`)
    .join('');
  // Each link is a clickable word ("LinkedIn") with the address kept in a relationship.
  const linkBody = links
    .map(
      (_, i) =>
        `<w:p><w:hyperlink r:id="rIdLink${i + 1}"><w:r><w:t>Link ${i + 1}</w:t></w:r></w:hyperlink></w:p>`,
    )
    .join('');
  const zip = new JSZip();
  if (links.length > 0) {
    zip.file(
      'word/_rels/document.xml.rels',
      '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        links
          .map(
            (url, i) =>
              `<Relationship Id="rIdLink${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${escapeXml(url)}" TargetMode="External"/>`,
          )
          .join('') +
        '</Relationships>',
    );
  }
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
    `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>${body}${linkBody}</w:body></w:document>`,
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
  'Mobile: +94 70 000 0003',
  'Email: sam.one@example.test',
  'Alt email: sam.two@example.test',
  'Studied 2019 - 2022 at a fictional place.',
];

// Text at exact positions (points from the top-left of the page), written in
// the order given. Used for layouts that a plain list of lines cannot make,
// such as two columns written row by row.
export function buildPositionedPdf(placements) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 0 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    for (const { text, x, y, size = 11 } of placements) {
      doc.fontSize(size).text(text, x, y, { lineBreak: false });
    }
    doc.end();
  });
}

// A resume template that still has its placeholder text. Fictional.
export const TEMPLATE_CV = [
  'Your Name',
  'Contact',
  'Address',
  'Santa Ana, CA 92703',
  'Email',
  'your-name@email.com',
  'Phone',
  '(555) 555-5555',
  'Education',
  'Bachelor of Science,',
  'Computer Science',
  'University of California, Irvine',
  '2012 - 2016',
];

// A two-column CV (contact sidebar on the left, education and skills on the
// right) written ROW BY ROW, which is how many designed CVs are exported: the
// left and right pieces of a row sit one after the other in the file.
export function twoColumnPlacements() {
  const left = [
    'Contact',
    'Phone',
    '0771234567',
    'Email',
    'anusha.perera@example.test',
    'Address',
    '123 Example Road, Colombo',
    'Sri Lanka',
  ];
  const right = [
    'Education',
    'Bachelor of Science,',
    'Computer Science',
    'University of Example, Colombo',
    '2015 - 2019',
    'Skills',
    'Pretend programming',
    'Imaginary databases',
  ];
  const placements = [
    { text: 'ANUSHA PERERA', x: 50, y: 40, size: 18 },
    { text: 'Software Developer', x: 50, y: 70 },
  ];
  left.forEach((text, row) => {
    placements.push({ text, x: 50, y: 120 + row * 20 });
    placements.push({ text: right[row], x: 330, y: 120 + row * 20 });
  });
  return placements;
}

// A single-column CV with a "candidate information" table: field labels at one
// edge and their values at another, on the same rows, among full-width text.
// This is the layout of many application-form style CVs. Fictional.
export const FORM_TABLE_ROWS = [
  ['Name', 'Nimal Fernando'],
  ['Phone', '0771234567'],
  ['Email', 'nimal.fernando@email.com'],
  ['Address', '45 Sample Street, Kandy, Sri Lanka'],
  ['O/L Maths', 'B'],
  ['A/L Result', '2 B passes'],
  ['A/L Stream', 'Commerce'],
  ['Other Education', 'Diploma in Imaginary Design - Example Institute'],
  ['Applied Position', 'UI/UX Designer'],
  ['Source', 'Referral'],
];

export function formTablePlacements(rows = FORM_TABLE_ROWS) {
  const placements = [
    { text: 'NIMAL FERNANDO', x: 200, y: 40, size: 16 },
    { text: 'Kandy, Sri Lanka | nimal.fernando@email.com', x: 57, y: 70 },
    { text: 'CANDIDATE INFORMATION', x: 57, y: 100, size: 12 },
  ];
  rows.forEach(([label, value], i) => {
    placements.push({ text: label, x: 71, y: 130 + i * 25 });
    placements.push({ text: value, x: 193, y: 130 + i * 25 });
  });
  const below = 130 + rows.length * 25 + 20;
  placements.push(
    { text: 'PROFESSIONAL SUMMARY', x: 57, y: below, size: 12 },
    {
      text: 'Creative designer with an interest in interfaces and a long line of text that runs across the page.',
      x: 57,
      y: below + 20,
    },
    { text: 'TECHNICAL SKILLS', x: 57, y: below + 50, size: 12 },
    { text: 'Tools: Figma, Sketch, Illustrator', x: 57, y: below + 70 },
    { text: 'EXPERIENCE', x: 57, y: below + 100, size: 12 },
    { text: 'Graphic Designer - Example Studio, Kandy', x: 57, y: below + 120 },
  );
  return placements;
}
