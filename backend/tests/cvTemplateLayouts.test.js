// Template placeholders, label-only lines, complete education, and multi-column
// PDF layouts. Fictional CVs only; nothing here touches a database or network.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { extractCv } from '../src/modules/cv-extraction/extractCv.js';
import { layoutPageText } from '../src/modules/cv-extraction/pdfLayout.js';
import {
  TEMPLATE_CV,
  buildDocx,
  buildPdf,
  buildPositionedPdf,
  twoColumnPlacements,
} from './helpers/fictionalCv.js';

const PAD = 'Fictional padding line to make the test file long enough.';

async function both(lines) {
  const all = [...lines, PAD];
  return [
    await extractCv({ buffer: await buildDocx(all) }),
    await extractCv({ buffer: await buildPdf(all) }),
  ];
}

describe('a resume template that still has its placeholder text', () => {
  test('placeholders are left empty, and nothing is made up in their place', async () => {
    for (const result of await both(TEMPLATE_CV)) {
      assert.equal(result.formDraft.fullName, undefined);
      assert.equal(result.formDraft.email, undefined);
      assert.equal(result.formDraft.phone, undefined);
      for (const name of ['fullName', 'email', 'phone']) {
        assert.equal(result.fields[name].status, 'unavailable', name);
        assert.equal(result.fields[name].value, null, name);
        assert.match(result.fields[name].note, /template text/, name);
      }
      assert.ok(result.warnings.some((w) => /template text/.test(w)));
    }
  });

  test('the address no longer swallows the next label', async () => {
    for (const result of await both(TEMPLATE_CV)) {
      assert.equal(result.formDraft.address, 'Santa Ana, CA 92703');
      assert.doesNotMatch(result.formDraft.address, /Email|Phone/);
    }
  });

  test('the whole degree is kept: its wrapped lines, institution and years', async () => {
    for (const result of await both(TEMPLATE_CV)) {
      assert.equal(
        result.formDraft.otherEducation,
        'Bachelor of Science, Computer Science, University of California, Irvine, 2012 - 2016',
      );
    }
  });

  test('applied position and source are not invented from a template', async () => {
    for (const result of await both(TEMPLATE_CV)) {
      assert.equal(result.hints.appliedPosition, null);
      assert.equal(result.hints.source, null);
    }
  });
});

describe('placeholder values of every kind are ignored, real ones are kept', () => {
  const lines = (name, email, phone) => [name, `Email: ${email}`, `Phone: ${phone}`];

  test('placeholder emails', async () => {
    for (const email of [
      'your-name@email.com',
      'yourname@example.com',
      'name@email.com',
      'email@email.com',
      'firstname.lastname@email.com',
      'user@domain.com',
      'your.email@yourdomain.com',
    ]) {
      for (const result of await both(lines('Nimal Perera', email, '0771234567'))) {
        assert.equal(result.formDraft.email, undefined, email);
      }
    }
  });

  test('placeholder names', async () => {
    for (const name of [
      'Your Name',
      'YOUR NAME',
      'First Last',
      '[Your Name]',
      'John Doe',
      'Full Name',
    ]) {
      for (const result of await both(lines(name, 'nimal@example.test', '0771234567'))) {
        assert.equal(result.formDraft.fullName, undefined, name);
      }
    }
  });

  test('placeholder phones', async () => {
    for (const phone of [
      '(555) 555-5555',
      '555-555-5555',
      '123-456-7890',
      '000-000-0000',
      '+1 (555) 123-4567',
      '555-123-4567',
    ]) {
      for (const result of await both(lines('Nimal Perera', 'nimal@example.test', phone))) {
        assert.equal(result.formDraft.phone, undefined, phone);
      }
    }
  });

  test('real values that merely look similar are kept', async () => {
    for (const result of await both([
      'Nimal Perera',
      'Email: nimal.perera@example.test',
      'Phone: +94 77 123 4567',
    ])) {
      assert.equal(result.formDraft.fullName, 'Nimal Perera');
      assert.equal(result.formDraft.email, 'nimal.perera@example.test');
      assert.equal(result.formDraft.phone, '+94771234567');
    }
    // Digits that contain "555" inside a real Sri Lankan number are not a placeholder.
    for (const result of await both(['Nimal Perera', 'Phone: 0755551234'])) {
      assert.equal(result.formDraft.phone, '0755551234');
    }
  });

  test('a real email next to a placeholder one is the one chosen', async () => {
    for (const result of await both([
      'Nimal Perera',
      'Email: your-name@email.com',
      'Email: nimal.perera@example.test',
    ])) {
      assert.equal(result.formDraft.email, 'nimal.perera@example.test');
      assert.equal(result.fields.email.status, 'extracted');
    }
  });
});

describe('labels that stand alone on their own line', () => {
  test('Address, Email and Phone as lone labels with the values below', async () => {
    const lines = [
      'ANUSHA PERERA',
      'Address',
      '123 Example Road, Colombo',
      'Sri Lanka',
      'Email',
      'anusha.perera@example.test',
      'Phone',
      '0771234567',
    ];
    for (const result of await both(lines)) {
      assert.equal(result.formDraft.address, '123 Example Road, Colombo, Sri Lanka');
      assert.equal(result.formDraft.email, 'anusha.perera@example.test');
      assert.equal(result.formDraft.phone, '0771234567');
      assert.equal(result.formDraft.fullName, 'ANUSHA PERERA');
    }
  });

  test('a lone Name label takes the line below', async () => {
    for (const result of await both(['Name', 'Nimal Perera', 'Phone: 0771234567'])) {
      assert.equal(result.formDraft.fullName, 'Nimal Perera');
    }
  });

  test('the phone label is on the line above even when other text sits between sections', async () => {
    for (const result of await both(['Nimal Perera', 'Mobile', '0771234567'])) {
      assert.equal(result.formDraft.phone, '0771234567');
    }
  });
});

describe('address and email on the same line', () => {
  const EXPECT = '123 Example Road, Colombo, Sri Lanka';
  const VARIANTS = [
    `Address: ${EXPECT} Email: anusha.perera@example.test`,
    `Address ${EXPECT} Email anusha.perera@example.test`,
    `Address: ${EXPECT}, Email`,
    `Address: ${EXPECT} | Phone: 0771234567 | Email: anusha.perera@example.test`,
    `Address ${EXPECT} Phone 0771234567`,
  ];
  for (const line of VARIANTS) {
    test(`"${line.slice(0, 48)}..." keeps the address clean`, async () => {
      for (const result of await both(['ANUSHA PERERA', line])) {
        assert.equal(result.formDraft.address, EXPECT);
        assert.doesNotMatch(result.formDraft.address, /Email|Phone|@|0771234567/);
      }
    });
  }

  test('the email and phone on that line are still found', async () => {
    const line = `Address: ${EXPECT} | Phone: 0771234567 | Email: anusha.perera@example.test`;
    for (const result of await both(['ANUSHA PERERA', line])) {
      assert.equal(result.formDraft.email, 'anusha.perera@example.test');
      assert.equal(result.formDraft.phone, '0771234567');
    }
  });
});

describe('complete education', () => {
  test('several degrees, each with its institution and years', async () => {
    const lines = [
      'ANUSHA PERERA',
      'Education',
      'Bachelor of Science in Computer Science',
      'University of Example, Colombo',
      '2015 - 2019',
      'Diploma in Web Design,',
      'Example Institute of Technology',
      '2013 - 2014',
    ];
    for (const result of await both(lines)) {
      assert.equal(
        result.formDraft.otherEducation,
        [
          'Bachelor of Science in Computer Science, University of Example, Colombo, 2015 - 2019',
          'Diploma in Web Design, Example Institute of Technology, 2013 - 2014',
        ].join('\n'),
      );
    }
  });

  test('an unrelated line after a degree is not pulled in', async () => {
    const lines = [
      'ANUSHA PERERA',
      'Education',
      'Bachelor of Science in Computer Science',
      'Pretend programming skills',
    ];
    for (const result of await both(lines)) {
      assert.equal(result.formDraft.otherEducation, 'Bachelor of Science in Computer Science');
    }
    const next = [
      'ANUSHA PERERA',
      'Education',
      'Bachelor of Science in Computer Science',
      'Skills',
      'Pretend programming',
    ];
    for (const result of await both(next)) {
      assert.equal(result.formDraft.otherEducation, 'Bachelor of Science in Computer Science');
    }
  });
});

describe('a PDF laid out in columns', () => {
  test('a two-column CV written row by row is read column by column', async () => {
    const result = await extractCv({ buffer: await buildPositionedPdf(twoColumnPlacements()) });
    assert.equal(result.formDraft.fullName, 'ANUSHA PERERA');
    assert.equal(result.formDraft.phone, '0771234567');
    assert.equal(result.formDraft.email, 'anusha.perera@example.test');
    assert.equal(result.formDraft.address, '123 Example Road, Colombo, Sri Lanka');
    assert.equal(
      result.formDraft.otherEducation,
      'Bachelor of Science, Computer Science, University of Example, Colombo, 2015 - 2019',
    );
    assert.equal(result.hints.targetPosition, 'Software Developer');
    // Nothing from the other column leaked into the address.
    assert.doesNotMatch(result.formDraft.address, /Skills|Education|Bachelor/);
  });

  test('a single-column PDF is read exactly as before', async () => {
    const result = await extractCv({
      buffer: await buildPdf([
        'ANUSHA PERERA',
        'Phone: 0771234567',
        'Email: anusha.perera@example.test',
        'Address: 123 Example Road, Colombo',
        'Education',
        'Bachelor of Science, Computer Science',
        'University of Example, Colombo',
      ]),
    });
    assert.equal(result.formDraft.address, '123 Example Road, Colombo');
    assert.equal(
      result.formDraft.otherEducation,
      'Bachelor of Science, Computer Science, University of Example, Colombo',
    );
  });

  // layoutPageText on pieces of text with positions, no PDF needed.
  const item = (str, x, y, width = str.length * 5) => ({
    str,
    width,
    height: 11,
    transform: [11, 0, 0, 11, x, y],
  });

  test('a label with its value beside it stays on one line (a form, not columns)', () => {
    const items = [
      item('Name:', 50, 700),
      item('Nimal Perera', 200, 700),
      item('Phone:', 50, 680),
      item('0771234567', 200, 680),
      item('Email:', 50, 660),
      item('nimal@example.test', 200, 660),
      item('Address:', 50, 640),
      item('12 Lane, Colombo', 200, 640),
    ];
    assert.equal(
      layoutPageText(items),
      [
        'Name: Nimal Perera',
        'Phone: 0771234567',
        'Email: nimal@example.test',
        'Address: 12 Lane, Colombo',
      ].join('\n'),
    );
  });

  test('indented lines and a date at the right edge do not make columns', () => {
    const items = [
      item('Education', 50, 700),
      item('Bachelor of Science', 70, 680),
      item('2015 - 2019', 400, 680),
      item('University of Example', 70, 660),
      item('Diploma in Design', 70, 640),
      item('2013 - 2014', 400, 640),
    ];
    const text = layoutPageText(items);
    assert.match(text, /Bachelor of Science 2015 - 2019/);
    assert.match(text, /Diploma in Design 2013 - 2014/);
  });

  test('two real columns are read one after the other', () => {
    const items = [];
    ['Contact', 'Phone', '0771234567', 'Email'].forEach((t, i) => {
      items.push(item(t, 50, 700 - i * 20));
    });
    ['Education', 'Bachelor of Science,', 'Computer Science', '2015 - 2019'].forEach((t, i) => {
      items.push(item(t, 330, 700 - i * 20));
    });
    assert.equal(
      layoutPageText(items),
      [
        'Contact',
        'Phone',
        '0771234567',
        'Email',
        'Education',
        'Bachelor of Science,',
        'Computer Science',
        '2015 - 2019',
      ].join('\n'),
    );
  });

  test('a page with no text gives an empty string', () => {
    assert.equal(layoutPageText([]), '');
  });
});

describe('a fictional CV with every supported detail', () => {
  test('all of it is extracted, in Word and in PDF', async () => {
    const lines = [
      'ANUSHA PERERA',
      'Phone: +94 77 123 4567',
      'Email: anusha.perera@example.test',
      'Address: 123 Example Road, Colombo, Sri Lanka, O/L Maths A, A/L Result 3 A passes, A/L Stream Physical Science',
      'Applied Position: Software Developer',
      'Source: LinkedIn',
      'Education',
      'Bachelor of Science in Imaginary Computing',
      'University of Example, Colombo',
      '2019 - 2023',
    ];
    for (const result of await both(lines)) {
      assert.equal(result.formDraft.fullName, 'ANUSHA PERERA');
      assert.equal(result.formDraft.phone, '+94771234567');
      assert.equal(result.formDraft.email, 'anusha.perera@example.test');
      assert.equal(result.formDraft.address, '123 Example Road, Colombo, Sri Lanka');
      assert.equal(result.formDraft.olMaths, 'A');
      assert.equal(result.formDraft.alResult, '3 A passes');
      assert.equal(result.formDraft.alStream, 'Physical Science');
      assert.equal(
        result.formDraft.otherEducation,
        'Bachelor of Science in Imaginary Computing, University of Example, Colombo, 2019 - 2023',
      );
      assert.deepEqual(result.hints, {
        appliedPosition: 'Software Developer',
        targetPosition: null,
        source: 'LinkedIn',
      });
    }
  });
});
