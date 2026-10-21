// Address and education must be kept apart: an address stops where another
// labelled field starts, and labelled education fields are found anywhere in
// the CV, several to a line. Fictional CVs only; nothing touches a database.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { extractCv } from '../src/modules/cv-extraction/extractCv.js';
import { buildDocx, buildPdf } from './helpers/fictionalCv.js';

const PADDING = 'Fictional padding line to make the test file long enough.';
const HEADER = ['ANUSHA PERERA', 'Phone: 0771234567', 'Email: anusha.perera@example.test'];

// The same CV as a Word file and as a PDF.
async function both(lines) {
  const all = [...lines.slice(0, 3), PADDING, ...lines.slice(3)];
  return [
    await extractCv({ buffer: await buildDocx(all) }),
    await extractCv({ buffer: await buildPdf(all) }),
  ];
}

const EXPECTED = {
  address: '123 Example Road, Colombo, Sri Lanka',
  olMaths: 'A',
  alResult: '3 A passes',
  alStream: 'Physical Science',
};

function assertExpected(result, expected = EXPECTED) {
  for (const [name, value] of Object.entries(expected)) {
    assert.equal(result.formDraft[name], value, name);
    assert.equal(result.fields[name].status, 'extracted', name);
  }
  // Name, phone and email are unaffected.
  assert.equal(result.formDraft.fullName, 'ANUSHA PERERA');
  assert.equal(result.formDraft.phone, '0771234567');
  assert.equal(result.formDraft.email, 'anusha.perera@example.test');
}

describe('address and education on one line', () => {
  const LINE =
    'Address: 123 Example Road, Colombo, Sri Lanka, O/L Maths A, A/L Result 3 A passes, A/L Stream Physical Science';

  test('are split into their own fields (Word and PDF, including a PDF line that wraps)', async () => {
    for (const result of await both([...HEADER, LINE])) {
      assertExpected(result);
      assert.ok(!result.formDraft.address.includes('O/L'));
      assert.ok(!/A\/L|Maths|Stream/.test(result.formDraft.address));
    }
  });

  test('no "No Education section" warning when education was found', async () => {
    for (const result of await both([...HEADER, LINE])) {
      assert.deepEqual(result.warnings, []);
    }
  });

  test('other separators and any order work: semicolons, pipes, colons', async () => {
    const variants = [
      'Address: 123 Example Road, Colombo, Sri Lanka; O/L Maths: A; A/L Result: 3 A passes; A/L Stream: Physical Science',
      'Address: 123 Example Road, Colombo, Sri Lanka | O/L Maths - A | A/L Result - 3 A passes | A/L Stream - Physical Science',
      'Address: 123 Example Road, Colombo, Sri Lanka, A/L Stream Physical Science, A/L Result 3 A passes, O/L Maths A',
    ];
    for (const line of variants) {
      for (const result of await both([...HEADER, line])) assertExpected(result);
    }
  });

  test('an address with no education after it is unchanged', async () => {
    for (const result of await both([...HEADER, 'Address: 123 Example Road, Colombo, Sri Lanka'])) {
      assert.equal(result.formDraft.address, EXPECTED.address);
      for (const name of ['olMaths', 'alResult', 'alStream']) {
        assert.equal(result.fields[name].status, 'unavailable', name);
        assert.equal(result.formDraft[name], undefined, name);
      }
    }
  });
});

describe('address and education on separate lines', () => {
  test('each labelled line goes to its own field', async () => {
    const lines = [
      ...HEADER,
      'Address: 123 Example Road, Colombo, Sri Lanka',
      'O/L Maths: A',
      'A/L Result: 3 A passes',
      'A/L Stream: Physical Science',
    ];
    for (const result of await both(lines)) assertExpected(result);
  });

  test('a multi-line address stops at the first education label', async () => {
    const lines = [...HEADER, 'Address: 123 Example Road,', 'Colombo, Sri Lanka', 'O/L Maths A'];
    for (const result of await both(lines)) {
      assert.equal(result.formDraft.address, '123 Example Road, Colombo, Sri Lanka');
      assert.equal(result.formDraft.olMaths, 'A');
    }
  });

  test('an education label in the middle of an address line ends the address there', async () => {
    const lines = [...HEADER, 'Address: 123 Example Road,', 'Colombo, Sri Lanka, O/L Maths A'];
    for (const result of await both(lines)) {
      assert.equal(result.formDraft.address, '123 Example Road, Colombo, Sri Lanka');
      assert.equal(result.formDraft.olMaths, 'A');
    }
  });

  test('a label at the end of a line takes the next line as its value', async () => {
    const lines = [
      ...HEADER,
      'Address: 123 Example Road, Colombo, Sri Lanka',
      'A/L Stream:',
      'Commerce',
    ];
    for (const result of await both(lines)) {
      assert.equal(result.formDraft.alStream, 'Commerce');
      assert.equal(result.formDraft.address, EXPECTED.address);
    }
  });
});

describe('education with and without a heading', () => {
  test('labelled education is found with no Education heading at all', async () => {
    const lines = [...HEADER, 'O/L Maths B', 'A/L Result 2 B passes', 'A/L Stream Commerce'];
    for (const result of await both(lines)) {
      assert.equal(result.formDraft.olMaths, 'B');
      assert.equal(result.formDraft.alResult, '2 B passes');
      assert.equal(result.formDraft.alStream, 'Commerce');
      assert.ok(!result.warnings.some((w) => /Education/.test(w)));
    }
  });

  test('labelled education inside an Education section, with other education too', async () => {
    const lines = [
      ...HEADER,
      'Address: 123 Example Road, Colombo, Sri Lanka',
      'Education',
      'O/L Maths: A',
      'A/L Result: 3 A passes',
      'A/L Stream: Physical Science',
      'Other Education: Diploma in Dummy Web Design, Example Institute',
      'BSc in Imaginary Computing, Fictional University',
    ];
    for (const result of await both(lines)) {
      assertExpected(result);
      assert.match(result.formDraft.otherEducation, /Diploma in Dummy Web Design/);
      assert.match(result.formDraft.otherEducation, /BSc in Imaginary Computing/);
      assert.ok(!result.formDraft.otherEducation.includes('O/L'));
      assert.ok(!result.formDraft.address.includes('Diploma'));
    }
  });

  test('the older layout (headings and subject lines) still works', async () => {
    const lines = [
      ...HEADER,
      'Education',
      'G.C.E. Ordinary Level (2018) - Fictional College',
      'Mathematics: A, Science: B, English: C',
      'G.C.E. Advanced Level (2021) - Fictional College',
      'Stream: Physical Science',
      'Results: 2 Credits and 1 Pass',
    ];
    for (const result of await both(lines)) {
      assert.equal(result.formDraft.olMaths, 'A');
      assert.equal(result.formDraft.alStream, 'Physical Science');
      assert.equal(result.formDraft.alResult, '2 Credits and 1 Pass');
    }
  });

  test('academic qualifications are never part of the address', async () => {
    const lines = [
      ...HEADER,
      'Address: 5 Fictional Lane, Kandy',
      'Education',
      'BSc in Imaginary Computing, Fictional University',
      'Diploma in Dummy Web Design, Example Institute',
    ];
    for (const result of await both(lines)) {
      assert.equal(result.formDraft.address, '5 Fictional Lane, Kandy');
      assert.match(result.formDraft.otherEducation, /BSc in Imaginary Computing/);
    }
  });
});

describe('missing information', () => {
  test('no education at all: nothing is invented, and the Education warning stays', async () => {
    for (const result of await both([...HEADER, 'Address: 123 Example Road, Colombo'])) {
      for (const name of ['olMaths', 'alResult', 'alStream', 'otherEducation']) {
        assert.equal(result.fields[name].status, 'unavailable', name);
        assert.equal(result.fields[name].value, null, name);
        assert.equal(result.formDraft[name], undefined, name);
      }
      assert.ok(result.warnings.some((w) => /Education/.test(w)));
    }
  });

  test('no address: education is still read and nothing is made up for the address', async () => {
    for (const result of await both([
      ...HEADER,
      'O/L Maths A, A/L Result 3 A passes, A/L Stream Physical Science',
    ])) {
      assert.equal(result.fields.address.status, 'unavailable');
      assert.equal(result.formDraft.address, undefined);
      assert.equal(result.formDraft.olMaths, 'A');
      assert.equal(result.formDraft.alResult, '3 A passes');
      assert.equal(result.formDraft.alStream, 'Physical Science');
    }
  });
});

describe('ambiguous labels are left for HR', () => {
  test('two different O/L Maths grades: nothing is chosen', async () => {
    for (const result of await both([...HEADER, 'O/L Maths A', 'O/L Maths C'])) {
      assert.equal(result.fields.olMaths.status, 'uncertain');
      assert.equal(result.fields.olMaths.value, null);
      assert.deepEqual(result.fields.olMaths.alternatives, ['A', 'C']);
      assert.equal(result.formDraft.olMaths, undefined);
    }
  });

  test('two different A/L streams or results: nothing is chosen', async () => {
    const lines = [
      ...HEADER,
      'A/L Stream Commerce',
      'A/L Stream Arts',
      'A/L Result 3 passes',
      'A/L Result ABC',
    ];
    for (const result of await both(lines)) {
      for (const name of ['alStream', 'alResult']) {
        assert.equal(result.fields[name].status, 'uncertain', name);
        assert.equal(result.formDraft[name], undefined, name);
        assert.equal(result.fields[name].alternatives.length, 2, name);
      }
    }
  });

  test('an O/L Maths label with no clear grade is flagged, not guessed', async () => {
    for (const result of await both([...HEADER, 'O/L Maths Credit pass'])) {
      assert.equal(result.fields.olMaths.status, 'uncertain');
      assert.equal(result.formDraft.olMaths, undefined);
    }
  });

  test('the same value written twice is not a conflict', async () => {
    for (const result of await both([
      ...HEADER,
      'O/L Maths A',
      'A/L Stream Commerce, A/L Stream commerce',
    ])) {
      assert.equal(result.formDraft.olMaths, 'A');
      assert.equal(result.fields.alStream.status, 'extracted');
    }
  });

  test('a referee below References does not supply education', async () => {
    const lines = [...HEADER, 'References', 'Mr. Saman Referee', 'O/L Maths C'];
    for (const result of await both(lines)) {
      assert.equal(result.formDraft.olMaths, undefined);
    }
  });
});

describe('lines that follow an address or an education line', () => {
  test('a qualification line straight after the address (no heading) is not address text', async () => {
    const lines = [
      ...HEADER,
      'Address: 5 Fictional Lane, Kandy',
      'BSc in Imaginary Computing, Fictional University',
    ];
    for (const result of await both(lines)) {
      assert.equal(result.formDraft.address, '5 Fictional Lane, Kandy');
      // Not under an Education heading or a label, so it is not guessed at either.
      assert.equal(result.formDraft.otherEducation, undefined);
    }
  });

  test('a long education line followed by another line does not swallow that line', async () => {
    const long =
      'Address: 123 Example Road, Colombo, Sri Lanka, O/L Maths A, A/L Result 3 A passes, A/L Stream Physical Science';
    const lines = [...HEADER, long, 'Skills', 'Pretend programming'];
    const docx = await extractCv({ buffer: await buildDocx([...lines, PADDING]) });
    assert.equal(docx.formDraft.alStream, 'Physical Science');
    assert.deepEqual(docx.unmappedSections, ['skills']);
    const pdf = await extractCv({ buffer: await buildPdf([...lines, PADDING]) });
    assert.equal(pdf.formDraft.alStream, 'Physical Science');
    assert.equal(pdf.formDraft.address, EXPECTED.address);
  });

  test('a Word paragraph that merely continues is not glued on: each paragraph is its own line', async () => {
    const lines = [...HEADER, 'A/L Stream Commerce', 'Studied at a fictional college in Colombo.'];
    const result = await extractCv({ buffer: await buildDocx([...lines, PADDING]) });
    assert.equal(result.formDraft.alStream, 'Commerce');
  });
});

describe('Applied Position and Source beside the address', () => {
  test('are still read from their own labelled lines', async () => {
    const lines = [
      ...HEADER,
      'Address: 123 Example Road, Colombo, Sri Lanka, O/L Maths A',
      'Applied Position: QA Intern',
      'Source: LinkedIn',
    ];
    for (const result of await both(lines)) {
      assert.deepEqual(result.hints, {
        appliedPosition: 'QA Intern',
        targetPosition: null,
        source: 'LinkedIn',
      });
      assert.equal(result.formDraft.address, EXPECTED.address);
      assert.equal(result.formDraft.olMaths, 'A');
    }
  });

  test('a position or source is never taken from the address or education text', async () => {
    const lines = [
      ...HEADER,
      'Address: 123 Example Road, Colombo, O/L Maths A, A/L Stream Commerce',
    ];
    for (const result of await both(lines)) {
      assert.deepEqual(result.hints, { appliedPosition: null, targetPosition: null, source: null });
    }
  });
});
