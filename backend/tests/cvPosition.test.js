// The applied position and the target role a CV states. Fictional CVs only;
// nothing here touches a database.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { extractCv } from '../src/modules/cv-extraction/extractCv.js';
import { buildDocx, buildPdf } from './helpers/fictionalCv.js';

const HEADER = ['ANUSHA PERERA', 'Phone: 0771234567', 'Email: anusha.perera@example.test'];
const PAD = 'Fictional padding line to make the test file long enough.';

async function hintsOf(lines) {
  const out = [];
  for (const buffer of [await buildDocx(lines), await buildPdf(lines)]) {
    out.push((await extractCv({ buffer })).hints);
  }
  return out;
}

describe('an applied position the CV states', () => {
  const STATEMENTS = [
    ['Position Applied For: Software Developer', 'Software Developer'],
    ['Position applied for - Software Developer', 'Software Developer'],
    ['Applied Position: HR', 'HR'],
    ['Job Applied For: QA Intern', 'QA Intern'],
    ['Post Applying For: QA Intern', 'QA Intern'],
    ['Applying for: Intern', 'Intern'],
    ['Application for the post of QA Intern', 'QA Intern'],
    ['I am applying for the position of Software Developer at Example Ltd.', 'Software Developer'],
    ['I wish to apply for the role of UI/UX Designer.', 'UI/UX Designer'],
  ];
  for (const [line, expected] of STATEMENTS) {
    test(`"${line}" gives "${expected}"`, async () => {
      for (const hints of await hintsOf([...HEADER, line])) {
        assert.equal(hints.appliedPosition, expected);
      }
    });
  }

  test('a job held in the past is never an applied position', async () => {
    const lines = [
      ...HEADER,
      'Experience',
      'Worked as Software Developer at Example Ltd (2022 - 2024)',
      'Position: Software Developer',
      'Role: Team Lead',
    ];
    for (const hints of await hintsOf(lines)) {
      assert.equal(hints.appliedPosition, null);
      assert.equal(hints.targetPosition, null);
    }
  });
});

describe('other ways a CV writes the position', () => {
  test('a label with no colon, or with the value on the next line', async () => {
    for (const lines of [
      [...HEADER, 'Applied Position  Software Developer'],
      [...HEADER, 'Applied Position', 'Software Developer'],
      [...HEADER, 'Position Applied For', 'Software Developer'],
    ]) {
      for (const hints of await hintsOf(lines))
        assert.equal(hints.appliedPosition, 'Software Developer');
    }
  });

  test('"Applying for X" with no colon', async () => {
    for (const hints of await hintsOf([...HEADER, 'Applying for Software Developer'])) {
      assert.equal(hints.appliedPosition, 'Software Developer');
    }
  });

  test('a long sentence after "Applying for" is not taken as a position', async () => {
    const line = 'Applying for jobs since 2020 in many places across the whole country every year';
    for (const hints of await hintsOf([...HEADER, line])) assert.equal(hints.appliedPosition, null);
  });

  test('a job title directly under the name, or after it, is the target role', async () => {
    const under = [
      'ANUSHA PERERA',
      'Software Developer',
      'Phone: 0771234567',
      'Email: a@example.test',
    ];
    const beside = [
      'ANUSHA PERERA | Software Developer',
      'Phone: 0771234567',
      'Email: a@example.test',
    ];
    for (const lines of [under, beside]) {
      for (const hints of await hintsOf(lines)) {
        assert.equal(hints.targetPosition, 'Software Developer');
        assert.equal(hints.appliedPosition, null);
      }
    }
  });

  test('a name, a heading or a label line is not mistaken for a job title', async () => {
    for (const hints of await hintsOf([
      'Curriculum Vitae',
      'ANUSHA PERERA',
      'Phone: 0771234567',
      'Email: a@example.test',
    ])) {
      assert.equal(hints.targetPosition, null);
    }
    for (const hints of await hintsOf([...HEADER, 'Applying for Software Developer'])) {
      assert.equal(hints.targetPosition, null);
    }
  });

  test('a one-line objective', async () => {
    for (const hints of await hintsOf([
      ...HEADER,
      'Objective: Seeking a Software Developer role in a dynamic team.',
    ])) {
      assert.equal(hints.targetPosition, 'Software Developer');
    }
  });

  test('"a challenging position" is not a role', async () => {
    for (const hints of await hintsOf([
      ...HEADER,
      'Objective: Seeking a challenging position in a good company.',
    ])) {
      assert.equal(hints.targetPosition, null);
    }
  });
});

describe('how real CV headers lay out the name and the job title', () => {
  const LAYOUTS = {
    'name and title on one line': [
      'ANUSHA PERERA Software Developer',
      'Phone: 0771234567',
      'Email: a@example.test',
    ],
    'name - title': [
      'Anusha Perera - Software Developer',
      'Phone: 0771234567',
      'Email: a@example.test',
    ],
    'name | title': [
      'ANUSHA PERERA | Software Developer',
      'Phone: 0771234567',
      'Email: a@example.test',
    ],
    'title above the name': [
      'SOFTWARE DEVELOPER',
      'ANUSHA PERERA',
      'Phone: 0771234567',
      'Email: a@example.test',
    ],
    'title under the name': [
      'ANUSHA PERERA',
      'Software Developer',
      'Phone: 0771234567',
      'Email: a@example.test',
    ],
    'title after the contact lines': [
      'ANUSHA PERERA',
      'Phone: 0771234567',
      'Email: a@example.test',
      'Address: 12 Fictional Lane, Colombo',
      'Software Developer',
    ],
    'a Position: label in the header': [
      'ANUSHA PERERA',
      'Phone: 0771234567',
      'Email: a@example.test',
      'Position: Software Developer',
    ],
    'a Designation: label under Personal Details': [
      'ANUSHA PERERA',
      'Personal Details',
      'Designation: Software Developer',
      'Phone: 0771234567',
    ],
  };
  for (const [name, lines] of Object.entries(LAYOUTS)) {
    test(`${name}: the title is the target role and the name stays clean`, async () => {
      for (const buffer of [await buildDocx([...lines, PAD]), await buildPdf([...lines, PAD])]) {
        const result = await extractCv({ buffer });
        // The CV's own capitalisation is kept; the form's matching ignores case.
        assert.equal(result.hints.targetPosition.toLowerCase(), 'software developer');
        assert.match(result.formDraft.fullName, /^Anusha Perera$|^ANUSHA PERERA$/);
        assert.equal(result.formDraft.phone, '0771234567');
      }
    });
  }

  test('a title in a profile sentence, or a past job, is not a target role', async () => {
    for (const lines of [
      [...HEADER, 'Profile', 'Results-driven Software Developer with three years of experience.'],
      [...HEADER, 'Experience', 'Software Developer', 'Example Ltd (2022 - 2024)'],
    ]) {
      for (const hints of await hintsOf(lines)) assert.equal(hints.targetPosition, null);
    }
  });

  test('a name is never carried into the title, nor a title into the name', async () => {
    const result = await extractCv({
      buffer: await buildDocx(['ANUSHA PERERA Senior Web Designer', 'Phone: 0771234567', PAD]),
    });
    assert.equal(result.formDraft.fullName, 'ANUSHA PERERA');
    assert.equal(result.hints.targetPosition, 'Senior Web Designer');
  });
});

describe('a target role from the career objective (a suggestion only)', () => {
  test('a labelled target or desired position', async () => {
    for (const label of ['Desired Position', 'Target Role', 'Preferred Post', 'Position Sought']) {
      for (const hints of await hintsOf([...HEADER, `${label}: QA Intern`])) {
        assert.equal(hints.targetPosition, 'QA Intern', label);
        assert.equal(hints.appliedPosition, null, label);
      }
    }
  });

  test('a sentence in the career objective', async () => {
    const lines = [
      ...HEADER,
      'Career Objective',
      'To obtain a challenging position as a QA Intern in a growing company.',
    ];
    for (const hints of await hintsOf(lines)) {
      assert.equal(hints.targetPosition, 'QA Intern');
      assert.equal(hints.appliedPosition, null);
    }
  });

  test('other objective wordings', async () => {
    const cases = [
      ['Objective', 'Seeking an internship as Software Developer.', 'Software Developer'],
      ['Profile', 'Looking for the post of Data Analyst where I can learn.', 'Data Analyst'],
      ['Summary', 'To work as a Web Designer with a creative team.', 'Web Designer'],
    ];
    for (const [heading, sentence, expected] of cases) {
      for (const hints of await hintsOf([...HEADER, heading, sentence])) {
        assert.equal(hints.targetPosition, expected, sentence);
      }
    }
  });

  test('objective-sounding text in work experience, skills or projects is ignored', async () => {
    for (const heading of ['Experience', 'Work Experience', 'Skills', 'Projects']) {
      const lines = [...HEADER, heading, 'Seeking a position as Team Lead in a growing company.'];
      for (const hints of await hintsOf(lines)) {
        assert.equal(hints.targetPosition, null, heading);
      }
    }
  });

  test('a stated applied position and an objective can both be reported', async () => {
    const lines = [
      ...HEADER,
      'Applied Position: QA Intern',
      'Career Objective',
      'To work as a Test Engineer with a creative team.',
    ];
    for (const hints of await hintsOf(lines)) {
      assert.equal(hints.appliedPosition, 'QA Intern');
      assert.equal(hints.targetPosition, 'Test Engineer');
    }
  });

  test('a CV with no objective gives no suggestion', async () => {
    for (const hints of await hintsOf([...HEADER, 'Education', 'BSc in Imaginary Computing'])) {
      assert.equal(hints.targetPosition, null);
    }
  });
});
