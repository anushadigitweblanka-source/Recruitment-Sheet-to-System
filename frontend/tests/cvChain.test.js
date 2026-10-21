// @vitest-environment node
import { describe, expect, test } from 'vitest';
import { extractCv } from '../../backend/src/modules/cv-extraction/extractCv.js';
import {
  TEMPLATE_CV,
  buildDocx,
  buildPdf,
  buildPositionedPdf,
  formTablePlacements,
  twoColumnPlacements,
} from '../../backend/tests/helpers/fictionalCv.js';
import {
  applyExtraction,
  fillFields,
  positionSuggestion,
} from '../src/modules/candidates/cvFill.js';
import { isLinkedinProfileUrl } from '../src/modules/candidates/linkedin.js';

// The whole chain without a browser or a database: a real (fictional) PDF or
// Word CV is read by the real extractor, and its answer is put through the same
// fill logic the Add Candidate form uses, against fictional dropdown options.

const POSITIONS = [
  { id: 1, name: 'HR', isActive: true },
  { id: 2, name: 'Intern', isActive: true },
  { id: 3, name: 'Software Developer', isActive: true },
  { id: 4, name: 'UI/UX Designer', isActive: true },
  { id: 5, name: 'Retired Role', isActive: false },
];
const SOURCES = [
  { id: 7, name: 'LinkedIn', isActive: true },
  { id: 8, name: 'Referral', isActive: true },
];
const LOOKUPS = { positions: POSITIONS, sources: SOURCES };

const EMPTY = {
  fullName: '',
  phone: '',
  email: '',
  address: '',
  olMaths: '',
  alResult: '',
  alStream: '',
  otherEducation: '',
  positionId: '',
  sourceId: '',
  cvUrl: '',
};
const HEADER = ['ANUSHA PERERA', 'Phone: 0771234567', 'Email: anusha.perera@example.test'];
const PADDING = 'Fictional padding line to make the test file long enough.';

// Reads the CV (as Word and as PDF) and fills an empty form from each answer.
async function fillFromCv(lines, { values = EMPTY, autoFilled = {} } = {}) {
  const out = [];
  for (const buffer of [
    await buildDocx([...lines, PADDING]),
    await buildPdf([...lines, PADDING]),
  ]) {
    const body = { extraction: await extractCv({ buffer }), cvUrl: null };
    const result = applyExtraction({ values, autoFilled, body, lookups: LOOKUPS });
    out.push({ ...result, suggestion: positionSuggestion(body.extraction, LOOKUPS), body });
  }
  return out;
}

describe('Applied Position, from a real CV to the form', () => {
  const SELECTS = [
    ['Applied Position: Software Developer', '3'],
    ['Applied Position : Software Developer', '3'],
    ['Applied Position  Software Developer', '3'],
    ['Position Applied For: HR', '1'],
    ['Position Applied For - hr', '1'],
    ['Job Applied For: UI / UX  Designer', '4'],
    ['Applying for Intern', '2'],
    ['Applying for the post of Software Developer', '3'],
    ['Application for the post of Software Developer', '3'],
    ['I am applying for the position of Software Developer at Example Ltd.', '3'],
  ];
  for (const [line, id] of SELECTS) {
    test(`"${line}" selects option ${id}`, async () => {
      for (const { values, suggestion } of await fillFromCv([...HEADER, line])) {
        expect(values.positionId).toBe(id);
        expect(suggestion).toBeNull();
      }
    });
  }

  test('a label with its value on the next line (a Word table or form) selects it', async () => {
    for (const { values } of await fillFromCv([
      ...HEADER,
      'Applied Position',
      'Software Developer',
    ])) {
      expect(values.positionId).toBe('3');
    }
  });

  test('a job title under the name selects the matching option', async () => {
    const lines = [
      'ANUSHA PERERA',
      'Software Developer',
      'Phone: 0771234567',
      'Email: a@example.test',
    ];
    for (const { values } of await fillFromCv(lines)) expect(values.positionId).toBe('3');
    const piped = [
      'ANUSHA PERERA | Software Developer',
      'Phone: 0771234567',
      'Email: a@example.test',
    ];
    for (const { values } of await fillFromCv(piped)) expect(values.positionId).toBe('3');
  });

  test('real header layouts select the matching option and keep the name clean', async () => {
    const layouts = [
      ['ANUSHA PERERA Software Developer', 'Phone: 0771234567', 'Email: a@example.test'],
      ['Anusha Perera - Software Developer', 'Phone: 0771234567', 'Email: a@example.test'],
      ['SOFTWARE DEVELOPER', 'ANUSHA PERERA', 'Phone: 0771234567', 'Email: a@example.test'],
      [
        'ANUSHA PERERA',
        'Phone: 0771234567',
        'Email: a@example.test',
        'Address: 12 Fictional Lane, Colombo',
        'Software Developer',
      ],
      [
        'ANUSHA PERERA',
        'Phone: 0771234567',
        'Email: a@example.test',
        'Position: Software Developer',
      ],
      ['ANUSHA PERERA', 'Personal Details', 'Designation: Software Developer', 'Phone: 0771234567'],
    ];
    for (const lines of layouts) {
      for (const { values } of await fillFromCv(lines)) {
        expect(values.positionId, lines.join(' / ')).toBe('3');
        expect(values.fullName).toMatch(/^Anusha Perera$|^ANUSHA PERERA$/);
      }
    }
  });

  test('a title that matches no option (Junior Software Developer) is suggested, not selected', async () => {
    const lines = [
      'ANUSHA PERERA',
      'Junior Software Developer',
      'Phone: 0771234567',
      'Email: a@example.test',
    ];
    for (const { values, suggestion } of await fillFromCv(lines)) {
      expect(values.positionId).toBe('');
      expect(suggestion).toEqual({ kind: 'target', text: 'Junior Software Developer' });
    }
  });

  test('a career objective selects the matching option', async () => {
    const lines = [
      ...HEADER,
      'Career Objective',
      'To obtain a challenging position as a Software Developer in a growing company.',
    ];
    for (const { values } of await fillFromCv(lines)) expect(values.positionId).toBe('3');
    const oneLine = [...HEADER, 'Objective: Seeking a Software Developer role in a dynamic team.'];
    for (const { values } of await fillFromCv(oneLine)) expect(values.positionId).toBe('3');
  });

  test('a stated applied position beats the headline and the objective', async () => {
    const lines = [
      'ANUSHA PERERA',
      'Software Developer',
      'Phone: 0771234567',
      'Applied Position: HR',
    ];
    for (const { values } of await fillFromCv(lines)) expect(values.positionId).toBe('1');
  });

  test('previous employment never selects a position', async () => {
    const lines = [
      ...HEADER,
      'Experience',
      'Worked as Software Developer at Example Ltd (2022 - 2024)',
      'Position: Software Developer',
      'Role: HR Assistant',
    ];
    for (const { values, suggestion } of await fillFromCv(lines)) {
      expect(values.positionId).toBe('');
      expect(suggestion).toBeNull();
    }
  });

  test('a position that is not in the list is suggested, and nothing is selected', async () => {
    for (const { values, suggestion } of await fillFromCv([
      ...HEADER,
      'Applied Position: Rocket Scientist',
    ])) {
      expect(values.positionId).toBe('');
      expect(suggestion).toEqual({ kind: 'applied', text: 'Rocket Scientist' });
    }
    const headline = [
      'ANUSHA PERERA',
      'Rocket Engineer',
      'Phone: 0771234567',
      'Email: a@example.test',
    ];
    for (const { values, suggestion } of await fillFromCv(headline)) {
      expect(values.positionId).toBe('');
      expect(suggestion).toEqual({ kind: 'target', text: 'Rocket Engineer' });
    }
  });

  test('a switched-off position is not selected', async () => {
    for (const { values } of await fillFromCv([...HEADER, 'Applied Position: Retired Role'])) {
      expect(values.positionId).toBe('');
    }
  });

  test("HR's own selection is never replaced by a later CV", async () => {
    const lines = [...HEADER, 'Applied Position: Software Developer'];
    const first = (await fillFromCv(lines))[0];
    expect(first.values.positionId).toBe('3');

    // HR changes it to HR; the same CV is read again.
    const chosen = { ...first.values, positionId: '1' };
    const again = (await fillFromCv(lines, { values: chosen, autoFilled: first.autoFilled }))[0];
    expect(again.values.positionId).toBe('1');

    // Chosen before any CV was read.
    const typed = (await fillFromCv(lines, { values: { ...EMPTY, positionId: '2' } }))[0];
    expect(typed.values.positionId).toBe('2');
  });
});

describe('everything else still fills from the same CV', () => {
  test('name, phone, email, address, education, source and the link', async () => {
    const lines = [
      ...HEADER,
      'Address: 123 Example Road, Colombo, Sri Lanka, O/L Maths A, A/L Result 3 A passes, A/L Stream Physical Science',
      'Applied Position: Software Developer',
      'Source: LinkedIn',
    ];
    for (const { body } of await fillFromCv(lines)) {
      const filled = applyExtraction({
        values: EMPTY,
        autoFilled: {},
        body: { ...body, cvUrl: 'https://cv.example.test/anusha.pdf' },
        lookups: LOOKUPS,
      }).values;
      expect(filled).toMatchObject({
        fullName: 'ANUSHA PERERA',
        phone: '0771234567',
        email: 'anusha.perera@example.test',
        address: '123 Example Road, Colombo, Sri Lanka',
        olMaths: 'A',
        alResult: '3 A passes',
        alStream: 'Physical Science',
        positionId: '3',
        sourceId: '7',
        cvUrl: 'https://cv.example.test/anusha.pdf',
      });
    }
  });

  test('an unknown source stays unselected, and an uploaded file gets no link', async () => {
    for (const { values } of await fillFromCv([...HEADER, 'Source: Facebook'])) {
      expect(values.sourceId).toBe('');
      expect(values.cvUrl).toBe('');
    }
  });

  test('fillFields keeps what HR typed', () => {
    const { values } = fillFields({
      values: { ...EMPTY, sourceId: '8' },
      autoFilled: {},
      found: { sourceId: '7' },
      clearStale: true,
    });
    expect(values.sourceId).toBe('8');
  });
});

describe('real layouts: templates and columns, from the file to the form', () => {
  const fill = async (buffer) => {
    const body = { extraction: await extractCv({ buffer }), cvUrl: null };
    return applyExtraction({ values: EMPTY, autoFilled: {}, body, lookups: LOOKUPS }).values;
  };

  test('a template with placeholders fills only what is real', async () => {
    const lines = [...TEMPLATE_CV, PADDING];
    for (const buffer of [await buildDocx(lines), await buildPdf(lines)]) {
      const values = await fill(buffer);
      expect(values.fullName).toBe('');
      expect(values.email).toBe('');
      expect(values.phone).toBe('');
      expect(values.address).toBe('Santa Ana, CA 92703');
      expect(values.otherEducation).toBe(
        'Bachelor of Science, Computer Science, University of California, Irvine, 2012 - 2016',
      );
      expect(values.positionId).toBe('');
      expect(values.sourceId).toBe('');
    }
  });

  test('a two-column PDF fills every field from the right column', async () => {
    const values = await fill(await buildPositionedPdf(twoColumnPlacements()));
    expect(values).toMatchObject({
      fullName: 'ANUSHA PERERA',
      phone: '0771234567',
      email: 'anusha.perera@example.test',
      address: '123 Example Road, Colombo, Sri Lanka',
      otherEducation:
        'Bachelor of Science, Computer Science, University of Example, Colombo, 2015 - 2019',
      positionId: '3', // the "Software Developer" title under the name
    });
  });

  test('address and email on one line fill their own fields', async () => {
    const lines = [
      'ANUSHA PERERA',
      'Address: 123 Example Road, Colombo, Sri Lanka Email: anusha.perera@example.test',
      PADDING,
    ];
    for (const buffer of [await buildDocx(lines), await buildPdf(lines)]) {
      const values = await fill(buffer);
      expect(values.address).toBe('123 Example Road, Colombo, Sri Lanka');
      expect(values.email).toBe('anusha.perera@example.test');
    }
  });
});

describe('LinkedIn, from real files to the form', () => {
  const PROFILE = 'https://www.linkedin.com/in/example-profile';
  const HEAD = ['ANUSHA PERERA', 'Phone: 0771234567', 'Email: anusha.perera@example.test'];
  const fill = async (buffer) => {
    const body = { extraction: await extractCv({ buffer }), cvUrl: null };
    return applyExtraction({ values: EMPTY, autoFilled: {}, body, lookups: LOOKUPS }).values;
  };
  // The form has a field for it even though the database does not yet.
  const emptyWithLinkedin = { ...EMPTY, linkedinUrl: '' };

  test('written in the CV (Word and PDF)', async () => {
    const lines = [...HEAD, `LinkedIn: ${PROFILE}`, PADDING];
    for (const buffer of [await buildDocx(lines), await buildPdf(lines)]) {
      const body = { extraction: await extractCv({ buffer }), cvUrl: null };
      const { values } = applyExtraction({
        values: emptyWithLinkedin,
        autoFilled: {},
        body,
        lookups: LOOKUPS,
      });
      expect(values.linkedinUrl).toBe(PROFILE);
      expect(values.sourceId).toBe('');
      expect(values.fullName).toBe('ANUSHA PERERA');
    }
  });

  test('behind a clickable word, in a Word file and in a PDF', async () => {
    const lines = [...HEAD, 'See my profile', PADDING];
    for (const buffer of [
      await buildDocx(lines, [PROFILE]),
      await buildPdf(lines, { links: [PROFILE] }),
    ]) {
      const body = { extraction: await extractCv({ buffer }), cvUrl: null };
      const { values } = applyExtraction({
        values: emptyWithLinkedin,
        autoFilled: {},
        body,
        lookups: LOOKUPS,
      });
      expect(values.linkedinUrl).toBe(PROFILE);
    }
  });

  test('a CV without one, or with only a company page, leaves it empty', async () => {
    for (const extra of [[], ['Company: https://www.linkedin.com/company/example-ltd']]) {
      const lines = [...HEAD, ...extra, PADDING];
      for (const buffer of [await buildDocx(lines), await buildPdf(lines)]) {
        const values = await fill(buffer);
        expect(values.linkedinUrl ?? '').toBe('');
      }
    }
  });

  test('the form accepts only a personal profile address, by shape alone', () => {
    for (const ok of [
      PROFILE,
      'https://linkedin.com/in/example-profile/',
      'https://uk.linkedin.com/in/example-profile?x=1',
    ]) {
      expect(isLinkedinProfileUrl(ok), ok).toBe(true);
    }
    for (const bad of [
      '',
      'http://www.linkedin.com/in/example-profile',
      'https://www.linkedin.com/company/example-ltd',
      'https://www.linkedin.com/in/',
      'https://linkedin.com.example.test/in/example-profile',
      'https://example.test/in/example-profile',
      'https://user:pw@www.linkedin.com/in/example-profile',
      'https://www.linkedin.com/in/has space',
      'javascript:alert(1)',
    ]) {
      expect(isLinkedinProfileUrl(bad), bad).toBe(false);
    }
  });
});

describe('a form-style CV (candidate-information table), from the file to the form', () => {
  test('every labelled row fills its own field, and the position and source are selected', async () => {
    const body = {
      extraction: await extractCv({ buffer: await buildPositionedPdf(formTablePlacements()) }),
      cvUrl: null,
    };
    const { values } = applyExtraction({
      values: { ...EMPTY, linkedinUrl: '' },
      autoFilled: {},
      body,
      lookups: LOOKUPS,
    });
    expect(values).toMatchObject({
      fullName: 'Nimal Fernando',
      phone: '0771234567',
      email: 'nimal.fernando@email.com',
      address: '45 Sample Street, Kandy, Sri Lanka',
      olMaths: 'B',
      alResult: '2 B passes',
      alStream: 'Commerce',
      otherEducation: 'Diploma in Imaginary Design - Example Institute',
      positionId: '4', // UI/UX Designer, stated in the "Applied Position" row
      sourceId: '8', // Referral, stated in the "Source" row
      linkedinUrl: '', // the CV has no LinkedIn address: nothing is invented
      cvUrl: '',
    });
  });

  test('a pasted link applies the same mapping and adds only the CV Link', async () => {
    const body = {
      extraction: await extractCv({ buffer: await buildPositionedPdf(formTablePlacements()) }),
      cvUrl: 'https://cv.example.test/form.pdf',
    };
    const { values } = applyExtraction({ values: EMPTY, autoFilled: {}, body, lookups: LOOKUPS });
    expect(values.fullName).toBe('Nimal Fernando');
    expect(values.positionId).toBe('4');
    expect(values.sourceId).toBe('8');
    expect(values.cvUrl).toBe('https://cv.example.test/form.pdf');
  });
});
