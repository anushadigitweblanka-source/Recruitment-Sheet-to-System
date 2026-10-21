// Finds candidate fields in CV text using explicit labels and layout only.
// There is no guessing and no AI: a value is returned only when the text
// states it, and anything ambiguous is reported as uncertain for HR to check.
//
// Each field comes back as
//   { status: 'extracted' | 'uncertain' | 'unavailable', value, note, alternatives? }
// where `uncertain` still carries the best value found so HR can review it.

const SECTION_HEADINGS = [
  'education',
  'academic qualifications',
  'academic background',
  'educational qualifications',
  'qualifications',
  'skills',
  'technical skills',
  'key skills',
  'experience',
  'work experience',
  'professional experience',
  'employment history',
  'projects',
  'references',
  'referees',
  'personal details',
  'personal information',
  'contact',
  'contact details',
  'profile',
  'career objective',
  'objective',
  'summary',
  'professional summary',
  'languages',
  'interests',
  'hobbies',
  'achievements',
  'certifications',
  'declaration',
];
const HEADING_SET = new Set(SECTION_HEADINGS);
const EDUCATION_HEADINGS = new Set([
  'education',
  'academic qualifications',
  'academic background',
  'educational qualifications',
  'qualifications',
]);
// Sections that hold skills or work history. They are recognised so they are
// not mistaken for other fields, but their content is never copied anywhere.
const UNMAPPED_HEADINGS = new Set([
  'skills',
  'technical skills',
  'key skills',
  'experience',
  'work experience',
  'professional experience',
  'employment history',
  'projects',
]);

const available = (value, note = null) => ({ status: 'extracted', value, note });
const uncertain = (value, note, alternatives) => ({
  status: 'uncertain',
  value,
  note,
  ...(alternatives?.length ? { alternatives } : {}),
});
const unavailable = (note) => ({ status: 'unavailable', value: null, note });

const headingKey = (line) =>
  line
    .trim()
    .replace(/[:\-–—\s]+$/, '')
    .toLowerCase();
const isHeading = (line) => line.trim().length <= 40 && HEADING_SET.has(headingKey(line));

const LABEL_LINE =
  /^\s*(?:full\s+name|name|phone(?:\s+number)?|mobile(?:\s+no\.?|\s+number)?|tel(?:ephone)?|contact(?:\s+no\.?|\s+number)?|e-?mail(?:\s+address)?|address|permanent\s+address|nic|date\s+of\s+birth|dob|nationality|gender|marital\s+status|linkedin|github|website)\s*[:\-–]/i;

// ---------------------------------------------------------------- email

const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;

function findEmail(text) {
  const found = [];
  for (const match of text.matchAll(EMAIL_PATTERN)) {
    const email = match[0].replace(/[.]+$/, '').toLowerCase();
    if (!found.includes(email)) found.push(email);
  }
  if (found.length === 0) return unavailable('No email address was found in the CV.');
  if (found.length === 1) return available(found[0]);
  return uncertain(found[0], 'More than one email address was found. Confirm which to use.', found);
}

// ---------------------------------------------------------------- phone

// A run of digits with the separators people type, 9 to 15 digits in all.
const PHONE_PATTERN = /(?<![\w@/.-])(\+?\d(?:[\d\s\-().]{7,22}\d))(?![\w@])/g;

const digitsOf = (value) => value.replace(/\D/g, '');

function looksLikePhone(candidate) {
  const digits = digitsOf(candidate);
  if (digits.length < 9 || digits.length > 15) return false;
  // Two years such as "2019 - 2022", or a date such as 12.03.2001.
  if (/^(?:19|20)\d{2}\D+(?:19|20)\d{2}$/.test(candidate.trim())) return false;
  if (/^\d{1,2}[./-]\d{1,2}[./-]\d{2,4}$/.test(candidate.trim())) return false;
  // An old-style NIC is nine digits then V/X; the match stops before the letter.
  return true;
}

function findPhone(text, lines) {
  const found = [];
  const add = (raw) => {
    const value = raw.trim();
    if (!looksLikePhone(value)) return;
    const key = digitsOf(value).slice(-9);
    if (!found.some((f) => digitsOf(f.value).slice(-9) === key)) found.push({ value });
  };

  // Labelled lines come first, then any other phone-shaped number.
  const labelled = lines.filter((l) =>
    /^\s*(?:phone|mobile|tel|telephone|contact|cell)\b/i.test(l),
  );
  for (const line of labelled) for (const m of line.matchAll(PHONE_PATTERN)) add(m[1]);
  const labelledCount = found.length;
  for (const m of text.matchAll(PHONE_PATTERN)) add(m[1]);

  if (found.length === 0) return unavailable('No phone number was found in the CV.');
  const values = found.map((f) => f.value);
  if (found.length === 1) {
    return labelledCount === 1
      ? available(values[0])
      : uncertain(values[0], 'The number has no "Phone" or "Mobile" label. Confirm it is correct.');
  }
  return uncertain(
    values[0],
    'More than one phone number was found. Confirm which to use.',
    values,
  );
}

// ---------------------------------------------------------------- name

const NOT_A_NAME =
  /^(?:curriculum\s+vitae|resume|r[eé]sum[eé]|cv|personal\s+details|contact|profile|objective|summary|address|e-?mail|phone)\b/i;

function looksLikeName(line) {
  const text = line.trim();
  if (text.length < 3 || text.length > 60) return false;
  if (/[\d@:/\\|]/.test(text) || NOT_A_NAME.test(text) || isHeading(text)) return false;
  const words = text.split(/\s+/);
  if (words.length < 2 || words.length > 5) return false;
  return words.every((w) => /^[\p{L}][\p{L}.'’-]*$/u.test(w));
}

function findName(lines) {
  for (const line of lines) {
    const m = line.match(/^\s*(?:full\s+)?name\s*[:\-–]\s*(.+)$/i);
    if (m && looksLikeName(m[1])) return available(m[1].trim().replace(/\s+/g, ' '));
  }
  // No label: the first line of the CV, when it reads as a person's name.
  const top = lines.slice(0, 6).find((l) => l.trim() && !NOT_A_NAME.test(l.trim()));
  if (top && looksLikeName(top)) {
    return uncertain(
      top.trim().replace(/\s+/g, ' '),
      'Taken from the first line of the CV; it has no "Name" label. Confirm it is correct.',
    );
  }
  return unavailable('No name was found in the CV.');
}

// ---------------------------------------------------------------- address

function findAddress(lines) {
  for (let i = 0; i < lines.length; i += 1) {
    const m = lines[i].match(
      /^\s*(?:permanent\s+|postal\s+|current\s+|home\s+)?address\s*[:\-–]?\s*(.*)$/i,
    );
    if (!m) continue;
    const parts = m[1].trim() ? [m[1].trim()] : [];
    // The address may continue on the lines below, up to a blank line, a
    // label or a section heading.
    for (let j = i + 1; j < lines.length && parts.length < 4; j += 1) {
      const next = lines[j].trim();
      if (!next || LABEL_LINE.test(next) || isHeading(next)) break;
      if (next.includes('@')) break;
      parts.push(next);
    }
    if (parts.length === 0) continue;
    const value = parts
      .join(', ')
      .replace(/,\s*,/g, ',')
      .replace(/[,\s]+$/, '');
    return available(value);
  }
  return unavailable('No address with an "Address" label was found in the CV.');
}

// ---------------------------------------------------------------- education

const OL_HEAD = /\b(?:O\s?\/\s?L|O\.\s?L\.?|G\.?C\.?E\.?\s*\(?O(?:rdinary)?|Ordinary\s+Level)/i;
const AL_HEAD = /\b(?:A\s?\/\s?L|A\.\s?L\.?|G\.?C\.?E\.?\s*\(?A(?:dvanced)?|Advanced\s+Level)/i;
const HIGHER_EDU =
  /\b(?:B\.?\s?Sc|M\.?\s?Sc|B\.?\s?A\b|M\.?\s?A\b|B\.?\s?Eng|M\.?\s?Eng|B\.?\s?Tech|MBA|Ph\.?D|Bachelor|Master|Degree|Diploma|Higher\s+National|HND|NVQ|Certificate|Certification|Foundation|Associate)\b/i;

const STREAMS = [
  ['Physical Science', /\bphysical\s+science\b/i],
  ['Biological Science', /\bbio(?:logical)?\s+science\b|\bbiology\s+stream\b/i],
  ['Commerce', /\bcommerce\b/i],
  ['Arts', /\barts?\s+stream\b|\bstream\s*[:\-–]?\s*arts?\b/i],
  ['Technology', /\btechnology\s+stream\b|\bstream\s*[:\-–]?\s*technology\b/i],
  [
    'Mathematics',
    /\b(?:maths?|mathematics)\s+stream\b|\bstream\s*[:\-–]?\s*(?:maths?|mathematics)\b/i,
  ],
];

// The lines of the CV's education section, or [] when it has none.
function educationSection(lines) {
  const start = lines.findIndex((l) => EDUCATION_HEADINGS.has(headingKey(l)) && isHeading(l));
  if (start === -1) return [];
  const out = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    if (isHeading(lines[i]) && !EDUCATION_HEADINGS.has(headingKey(lines[i]))) break;
    out.push(lines[i]);
  }
  return out;
}

// Splits section lines into O/L, A/L and remaining groups. A group starts at
// a line naming that exam and runs to the next exam line or the next degree,
// diploma or certificate line. Blank lines are not used, because PDF and Word
// text differ in where they keep them.
function groupEducation(sectionLines) {
  const groups = { ol: [], al: [], other: [] };
  let current = 'other';
  for (const line of sectionLines) {
    if (!line.trim()) continue;
    if (OL_HEAD.test(line)) current = 'ol';
    else if (AL_HEAD.test(line)) current = 'al';
    else if (HIGHER_EDU.test(line)) current = 'other';
    groups[current].push(line.trim());
  }
  return groups;
}

const GRADE = /([ABCSW])(?![\w/.])/;

function findOlMaths(group, hasEducation) {
  if (group.length === 0) {
    return unavailable(
      hasEducation
        ? 'No O/L section was found in the Education section.'
        : 'No Education section with O/L results was found.',
    );
  }
  const joined = group.join(' ');
  const m = joined.match(new RegExp(`\\b[Mm]ath(?:s|ematics)?\\b[\\s:\\-–=()]*${GRADE.source}`));
  if (m) return available(m[1]);
  if (/\bmath(?:s|ematics)?\b/i.test(joined)) {
    return uncertain(
      null,
      'Mathematics is mentioned under O/L but no single-letter grade is stated.',
    );
  }
  return unavailable('The O/L results do not mention Mathematics.');
}

function findAl(group) {
  if (group.length === 0) {
    return {
      alResult: unavailable('No A/L section was found in the CV.'),
      alStream: unavailable('No A/L section was found in the CV.'),
    };
  }
  const joined = group.join(' ');

  let alStream;
  const streams = STREAMS.filter(([, pattern]) => pattern.test(joined)).map(([name]) => name);
  if (streams.length === 1) alStream = available(streams[0]);
  else if (streams.length > 1) {
    alStream = uncertain(
      streams[0],
      'More than one stream is mentioned. Confirm the stream.',
      streams,
    );
  } else alStream = unavailable('The A/L section does not state a stream.');

  let alResult;
  const labelled = group.map((l) => l.match(/\bresults?\s*[:\-–]\s*(.{1,100})$/i)).find(Boolean);
  const passes = joined.match(/\b(\d|one|two|three)\s+passes?\b/i);
  const grades = group
    .map((l) => l.match(/^(?:[-•*]\s*)?([A-Z][A-Za-z ]{2,30}?)\s*[:\-–=]\s*([ABCSW])\s*$/))
    .filter(Boolean);
  if (labelled) alResult = available(labelled[1].trim());
  else if (passes) alResult = available(passes[0].trim());
  else if (grades.length >= 2) {
    const value = grades.map((g) => `${g[1].trim()} ${g[2]}`).join(', ');
    alResult =
      value.length <= 100
        ? available(value, 'Assembled from the subject lines as written.')
        : uncertain(value.slice(0, 100), 'The subject grades are long; check the cut-off text.');
  } else alResult = unavailable('The A/L section does not state a result.');

  return { alResult, alStream };
}

function findOtherEducation(groups, sectionLines) {
  const own = sectionLines.length ? groups.other : [];
  const lines = own.filter((l) => HIGHER_EDU.test(l));
  const labelled = groups.other
    .map((l) => l.match(/^other\s+education\s*[:\-–]\s*(.+)$/i)?.[1])
    .filter(Boolean);
  const all = [...new Set([...labelled, ...lines])];
  if (all.length === 0) return unavailable('No degree, diploma or certificate was found.');
  const value = all.join('\n');
  if (value.length > 1000) {
    return uncertain(value.slice(0, 1000), 'The education text is long; check the cut-off text.');
  }
  return available(value);
}

// ---------------------------------------------------------------- all fields

// Names the CV sections that hold skills or work history. Their content is
// deliberately not read or stored: the candidate record has no field for it.
function findUnmappedSections(lines) {
  return [
    ...new Set(
      lines.filter((l) => isHeading(l) && UNMAPPED_HEADINGS.has(headingKey(l))).map(headingKey),
    ),
  ];
}

export function extractFields(text) {
  const lines = text.split('\n');
  const section = educationSection(lines);
  const groups = groupEducation(section);
  const { alResult, alStream } = findAl(groups.al);

  return {
    fields: {
      fullName: findName(lines),
      phone: findPhone(text, lines),
      email: findEmail(text),
      address: findAddress(lines),
      olMaths: findOlMaths(groups.ol, section.length > 0),
      alResult,
      alStream,
      otherEducation: findOtherEducation(groups, section),
    },
    unmappedSections: findUnmappedSections(lines),
    educationSectionFound: section.length > 0,
  };
}
