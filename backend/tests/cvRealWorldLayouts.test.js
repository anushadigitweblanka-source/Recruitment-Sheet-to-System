// Layouts found in real public sample resumes (ResumeGenius PDFs) that earlier
// tidy fixtures never covered. The text here is fictional; only the SHAPES are
// real: letter-spaced headings, unlabelled header addresses, US phone formats,
// a name guess from a wrapped paragraph, education in either order, document
// titles, and a two-column page with a narrow gutter. No network, no database.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { extractCv } from '../src/modules/cv-extraction/extractCv.js';
import { buildDocx, buildPdf, buildPositionedPdf } from './helpers/fictionalCv.js';

const PAD = 'Fictional padding line to make the test file long enough.';

async function both(lines) {
  const all = [...lines, PAD];
  return [
    await extractCv({ buffer: await buildDocx(all) }),
    await extractCv({ buffer: await buildPdf(all) }),
  ];
}

describe('letter-spaced headings', () => {
  test('"E D U CAT I O N" is a heading, so the education under it is found', async () => {
    const lines = [
      'Phone: 0771234567',
      'E D U CAT I O N',
      'Master in Imaginary Studies,',
      'Fictional University',
      'K EY S K I L LS',
      'Pretend programming',
    ];
    for (const result of await both(lines)) {
      assert.equal(
        result.formDraft.otherEducation,
        'Master in Imaginary Studies, Fictional University',
      );
    }
  });

  test('other letter-spaced headings end a section and are not read as content', async () => {
    const lines = [
      'E D U C A T I O N',
      'Bachelor of Science in Testing',
      'Example University',
      'P R O F E S S I O N A L E X P E R I E N C E',
      'Diploma in Nothing at a company that is not education',
    ];
    for (const result of await both(lines)) {
      assert.equal(
        result.formDraft.otherEducation,
        'Bachelor of Science in Testing, Example University',
      );
    }
  });
});

describe('an address in the header with no "Address" label', () => {
  test('a street line and a city, state and ZIP on the next line', async () => {
    const lines = [
      'C O N T A C T',
      '12 Fictional Avenue',
      'Fakeville, CA 90001',
      'E D U C A T I O N',
    ];
    for (const result of await both(lines)) {
      assert.equal(result.formDraft.address, '12 Fictional Avenue, Fakeville, CA 90001');
    }
  });

  test('a street that wrapped in the middle of the city', async () => {
    for (const result of await both(['12 Fictional Ave, Spring', 'Field, CA 90001', 'EDUCATION'])) {
      assert.equal(result.formDraft.address, '12 Fictional Ave, Spring Field, CA 90001');
    }
  });

  test('inside a header line with phone and email, separated by pipes', async () => {
    const line = '189 Sample Street, Fakeville, TX 79000 | (806) 625-9669 | someone@example.test';
    for (const result of await both([line])) {
      assert.equal(result.formDraft.address, '189 Sample Street, Fakeville, TX 79000');
      assert.equal(result.formDraft.phone, '8066259669');
    }
  });

  test('a labelled address still wins, and a street further down the CV is not an address', async () => {
    const labelled = ['Address: 5 Labelled Road, Colombo', '12 Header Street, Fakeville'];
    for (const result of await both(labelled)) {
      assert.equal(result.formDraft.address, '5 Labelled Road, Colombo');
    }
    const later = [
      'Name: Nimal Fernando',
      'EXPERIENCE',
      'Worked at 99 Office Street, Fakeville, CA 90002',
    ];
    for (const result of await both(later)) assert.equal(result.formDraft.address, undefined);
  });

  test('a template address is not taken', async () => {
    for (const result of await both(['City, state, zip code', '123 Main Street'])) {
      assert.equal(result.formDraft.address, undefined);
    }
  });
});

describe('phone numbers written the American way', () => {
  test('with no label, in the header', async () => {
    for (const phone of ['(806) 625-9669', '806-625-9669', '806.625.9669']) {
      for (const result of await both([`Fakeville, TX | ${phone} | someone@example.test`])) {
        assert.equal(result.formDraft.phone, '8066259669', phone);
      }
    }
  });

  test('under a lone "Phone" label', async () => {
    for (const result of await both(['CONTACT', 'Phone', '(442) 784-7891', 'Email'])) {
      assert.equal(result.formDraft.phone, '4427847891');
    }
  });

  test('but a 555 template number in the same style is still left empty', async () => {
    for (const phone of ['(323) 555-7107', '(555) 123-4567']) {
      for (const result of await both([`Fakeville, TX | ${phone} | someone@example.test`])) {
        assert.equal(result.formDraft.phone, undefined, phone);
      }
    }
  });

  test('plain digit runs, years and ZIP codes are not phones', async () => {
    for (const result of await both([
      '12 Fictional Ave, Fakeville, CA 90001',
      'Worked 2015 - 2019',
      'ID 123456789012',
    ])) {
      assert.equal(result.formDraft.phone, undefined);
    }
  });
});

describe('a name is never guessed from the end of a paragraph', () => {
  const PARAGRAPH = [
    'Creative professional with 5+ years of experience mixing recordings for services and other live events. Adept at',
    'adjusting channels to ensure excellent experiences at large venues. Excited to join the team and make a positive',
    'impact on upcoming live events and post-',
    'production projects.',
  ];

  test('"production projects." is not a name', async () => {
    for (const result of await both(['AUDIO ENGINEER RESUME', ...PARAGRAPH])) {
      assert.equal(result.formDraft.fullName, undefined);
    }
  });

  test('a sentence ending in a full stop is not a name, but a real name still is', async () => {
    for (const result of await both(['Skilled in design.', 'Nimal Fernando'])) {
      assert.equal(result.formDraft.fullName, 'Nimal Fernando');
    }
  });

  test('a document title is not a name', async () => {
    for (const result of await both([
      'NETWORK ENGINEER RESUME',
      'Example by Resume Genius',
      'Phone: 0771234567',
    ])) {
      assert.equal(result.formDraft.fullName, undefined);
    }
  });
});

describe('education in either order, and where it ends', () => {
  test('institution first, then degree, then date', async () => {
    const lines = [
      'EDUCATION',
      'Fictional State College, Springfield, OH',
      'Bachelor of Science, Testing,',
      'May 2017',
    ];
    for (const result of await both(lines)) {
      assert.equal(
        result.formDraft.otherEducation,
        'Fictional State College, Springfield, OH, Bachelor of Science, Testing, May 2017',
      );
    }
  });

  test('two entries in the same order are kept apart', async () => {
    const lines = [
      'EDUCATION',
      'First University',
      'Bachelor of Science in Alpha',
      'Second Institute',
      'Diploma in Beta',
    ];
    for (const result of await both(lines)) {
      assert.equal(
        result.formDraft.otherEducation,
        'First University, Bachelor of Science in Alpha\nSecond Institute, Diploma in Beta',
      );
    }
  });

  test('a CERTIFICATION heading ends the education section', async () => {
    const lines = [
      'EDUCATION',
      'Bachelor of Science in Alpha, Example University',
      'CERTIFICATION',
      'Certified Pretend Professional, Example Body 2022',
    ];
    for (const result of await both(lines)) {
      assert.equal(
        result.formDraft.otherEducation,
        'Bachelor of Science in Alpha, Example University',
      );
    }
  });

  test('a wrapped degree reads as one phrase, and a table divider is dropped', async () => {
    const lines = ['EDUCATION', 'Fictional College |', 'Associate of Arts in', 'Management'];
    for (const result of await both(lines)) {
      assert.equal(
        result.formDraft.otherEducation,
        'Fictional College, Associate of Arts in Management',
      );
    }
  });

  test('template years (20XX) are left out, real ones are kept', async () => {
    const lines = ['EDUCATION', 'Master in Alpha', 'Example University', '20XX - 20XX'];
    for (const result of await both(lines)) {
      assert.equal(result.formDraft.otherEducation, 'Master in Alpha, Example University');
    }
  });
});

describe('document titles are not job titles', () => {
  test('"NETWORK ENGINEER RESUME" and a title split over lines give no target role', async () => {
    for (const lines of [
      ['NETWORK ENGINEER RESUME', 'Phone: 0771234567'],
      ['BRANCH', 'MANAGER', 'RESUME', 'By Resume Genius'],
      ['CTO RESUME EXAMPLE', 'By Resume Genius'],
    ]) {
      for (const result of await both(lines)) {
        assert.equal(result.hints.targetPosition, null, lines.join(' / '));
      }
    }
  });

  test('a real headline under a name is still the target role', async () => {
    for (const result of await both(['NIMAL FERNANDO', 'Network Engineer', 'Phone: 0771234567'])) {
      assert.equal(result.hints.targetPosition, 'Network Engineer');
    }
  });
});

describe('a two-column page whose columns nearly touch', () => {
  // Left column text is wide, so the right column begins only ~15 points after it.
  const left = [
    'Walmart Sales Associate with 5+ years of exp',
    'exceptional customer experiences through ba',
    'responsibilities and managing individual sal',
    'position at a company to bring about chang',
    'through process improvement and continuous',
    'knowledge of store policies and good habits',
  ];
  const right = [
    'CONTACT',
    'Phone',
    '(442) 784-7891',
    'Email',
    'candidate.person@example.test',
    'LinkedIn',
  ];

  test('the right column is read separately: its phone and email are found', async () => {
    const placements = [{ text: 'SALES RESUME EXAMPLE', x: 50, y: 40, size: 16 }];
    left.forEach((text, i) => {
      placements.push({ text, x: 50, y: 100 + i * 20 });
      placements.push({ text: right[i], x: 335, y: 100 + i * 20 });
    });
    const result = await extractCv({ buffer: await buildPositionedPdf(placements) });
    assert.equal(result.formDraft.phone, '4427847891');
    assert.equal(result.formDraft.email, 'candidate.person@example.test');
  });
});
