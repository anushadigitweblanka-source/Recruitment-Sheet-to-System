// Form-style CVs: labels and values in a table, bare labels with no colon, and
// template placeholders. Fictional CVs only; no database, no network.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { extractCv } from '../src/modules/cv-extraction/extractCv.js';
import { layoutPageText } from '../src/modules/cv-extraction/pdfLayout.js';
import {
  FORM_TABLE_ROWS,
  buildDocx,
  buildPdf,
  buildPositionedPdf,
  formTablePlacements,
} from './helpers/fictionalCv.js';

const PAD = 'Fictional padding line to make the test file long enough.';

const EXPECTED = {
  fullName: 'Nimal Fernando',
  phone: '0771234567',
  email: 'nimal.fernando@email.com',
  address: '45 Sample Street, Kandy, Sri Lanka',
  olMaths: 'B',
  alResult: '2 B passes',
  alStream: 'Commerce',
  otherEducation: 'Diploma in Imaginary Design - Example Institute',
};

describe('a PDF with a candidate-information table among full-width text', () => {
  test('every labelled row is read into its own field, in order', async () => {
    const result = await extractCv({ buffer: await buildPositionedPdf(formTablePlacements()) });
    for (const [name, value] of Object.entries(EXPECTED)) {
      assert.equal(result.formDraft[name], value, name);
      assert.equal(result.fields[name].status, 'extracted', name);
    }
    assert.deepEqual(result.hints, {
      appliedPosition: 'UI/UX Designer',
      targetPosition: null,
      source: 'Referral',
    });
    assert.equal(result.status, 'extracted');
    assert.deepEqual(result.warnings, []);
  });

  test('the table is not mistaken for two page columns: no labels-first, values-last order', () => {
    const items = [];
    const piece = (str, x, y) => ({
      str,
      width: str.length * 5,
      height: 11,
      transform: [11, 0, 0, 11, x, y],
    });
    FORM_TABLE_ROWS.forEach(([label, value], i) => {
      items.push(piece(label, 71, 700 - i * 25), piece(value, 193, 700 - i * 25));
    });
    items.push(piece('PROFESSIONAL SUMMARY', 57, 400));
    items.push(
      piece(
        'A long full-width paragraph that runs well across the value column of the table above.',
        57,
        380,
      ),
    );
    items.push(piece('TECHNICAL SKILLS', 57, 350));
    items.push(
      piece('Tools: Figma, Sketch, Illustrator and a few more full-width words here', 57, 330),
    );
    const lines = layoutPageText(items).split('\n');
    assert.equal(lines[0], 'Name: Nimal Fernando');
    assert.equal(lines[8], 'Applied Position: UI/UX Designer');
    assert.equal(lines[9], 'Source: Referral');
    assert.ok(lines[10].startsWith('PROFESSIONAL SUMMARY'));
  });

  test('a different set of rows, a different order, and missing rows', async () => {
    const rows = [
      ['Source', 'LinkedIn'],
      ['Applied Position', 'Software Developer'],
      ['Phone', '+94 77 123 4567'],
      ['Name', 'Kamal Silva'],
    ];
    const result = await extractCv({ buffer: await buildPositionedPdf(formTablePlacements(rows)) });
    assert.equal(result.formDraft.fullName, 'Kamal Silva');
    assert.equal(result.formDraft.phone, '+94771234567');
    assert.equal(result.hints.appliedPosition, 'Software Developer');
    assert.equal(result.hints.source, 'LinkedIn');
    for (const name of ['address', 'olMaths', 'alResult', 'alStream', 'otherEducation']) {
      assert.equal(result.formDraft[name], undefined, name);
    }
  });

  test('a row whose value is empty gives an empty field, never the next label', async () => {
    const rows = [
      ['Name', 'Kamal Silva'],
      ['Address', ''],
      ['O/L Maths', ''],
      ['Other Education', ''],
      ['Applied Position', ''],
      ['Source', ''],
    ];
    const result = await extractCv({ buffer: await buildPositionedPdf(formTablePlacements(rows)) });
    assert.equal(result.formDraft.fullName, 'Kamal Silva');
    for (const name of ['address', 'olMaths', 'otherEducation']) {
      assert.equal(result.formDraft[name], undefined, name);
    }
    assert.equal(result.hints.appliedPosition, null);
    assert.equal(result.hints.source, null);
  });
});

describe('the same form as a Word table (each cell on its own line)', () => {
  const asCells = (rows) => rows.flatMap(([label, value]) => [label, value]);

  test('every labelled cell is read into its own field', async () => {
    const lines = ['NIMAL FERNANDO', 'CANDIDATE INFORMATION', ...asCells(FORM_TABLE_ROWS), PAD];
    const result = await extractCv({ buffer: await buildDocx(lines) });
    for (const [name, value] of Object.entries(EXPECTED)) {
      assert.equal(result.formDraft[name], value, name);
    }
    assert.equal(result.hints.appliedPosition, 'UI/UX Designer');
    assert.equal(result.hints.source, 'Referral');
  });

  test('a label with no value in the next cell takes nothing, not the next label', async () => {
    const lines = [
      'Name',
      'Kamal Silva',
      'Other Education',
      'Applied Position',
      'Source',
      'LinkedIn',
      PAD,
    ];
    const result = await extractCv({ buffer: await buildDocx(lines) });
    assert.equal(result.formDraft.fullName, 'Kamal Silva');
    assert.equal(result.formDraft.otherEducation, undefined);
    assert.equal(result.hints.appliedPosition, null);
    assert.equal(result.hints.source, 'LinkedIn');
  });

  test('all labels listed first and all values last is not guessed at', async () => {
    const labels = FORM_TABLE_ROWS.map(([label]) => label);
    const values = FORM_TABLE_ROWS.map(([, value]) => value);
    const result = await extractCv({
      buffer: await buildDocx([...labels, 'EXPERIENCE', ...values, PAD]),
    });
    // Nothing is a label's value here, so no label's value is invented.
    for (const name of ['olMaths', 'alResult', 'alStream', 'otherEducation']) {
      assert.equal(result.formDraft[name], undefined, name);
    }
    assert.equal(result.hints.appliedPosition, null);
  });
});

describe('placeholders and real values that look like them', () => {
  const HEAD = ['Name: Nimal Fernando', 'Address: 45 Sample Street, Kandy'];

  test('placeholder phones in several US styles are left empty', async () => {
    for (const phone of [
      '(123) 555-1234',
      '(555) 555-5555',
      '123-456-7890',
      '555-123-4567',
      '(000) 000-0000',
    ]) {
      const result = await extractCv({
        buffer: await buildDocx([...HEAD, `Phone: ${phone}`, PAD]),
      });
      assert.equal(result.formDraft.phone, undefined, phone);
    }
  });

  test('a real Sri Lankan number containing 555 is kept', async () => {
    const result = await extractCv({
      buffer: await buildDocx([...HEAD, 'Phone: 0755551234', PAD]),
    });
    assert.equal(result.formDraft.phone, '0755551234');
  });

  test('placeholder LinkedIn profiles are left empty', async () => {
    for (const url of [
      'linkedin.com/in/your-name/',
      'https://www.linkedin.com/in/your-name',
      'www.linkedin.com/in/yourname/',
      'https://www.linkedin.com/in/firstname-lastname',
    ]) {
      const result = await extractCv({
        buffer: await buildDocx([...HEAD, `LinkedIn: ${url}`, PAD]),
      });
      assert.equal(result.formDraft.linkedinUrl, undefined, url);
    }
  });

  test('a placeholder name or email is dropped, a personal one at the same provider is kept', async () => {
    const template = await extractCv({
      buffer: await buildDocx([
        'Your Name',
        'Email: your-name@email.com',
        'Address: 45 Sample Street, Kandy',
        PAD,
      ]),
    });
    assert.equal(template.formDraft.fullName, undefined);
    assert.equal(template.formDraft.email, undefined);

    const real = await extractCv({
      buffer: await buildDocx(['Nimal Fernando', 'Email: nimal.fernando@email.com', PAD]),
    });
    assert.equal(real.formDraft.email, 'nimal.fernando@email.com');
  });

  test('PDF and Word give the same result for a form CV', async () => {
    const lines = [
      'Name: Nimal Fernando',
      'Phone: 0771234567',
      'Email: nimal.fernando@email.com',
      'Source: Referral',
      PAD,
    ];
    const word = await extractCv({ buffer: await buildDocx(lines) });
    const pdf = await extractCv({ buffer: await buildPdf(lines) });
    assert.deepEqual(pdf.formDraft, word.formDraft);
    assert.deepEqual(pdf.hints, word.hints);
  });
});
