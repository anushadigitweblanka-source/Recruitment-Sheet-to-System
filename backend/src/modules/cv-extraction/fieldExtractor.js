// Finds candidate fields in CV text using explicit labels and layout only.
// There is no guessing and no AI: a value is returned only when the text
// states it, and anything ambiguous is reported as uncertain for HR to check.
//
// Each field comes back as
//   { status: 'extracted' | 'uncertain' | 'unavailable', value, note, alternatives? }
// where `uncertain` still carries the best value found so HR can review it.

import {
  beforeFirstLabel,
  isBareLabel,
  joinWrappedLines,
  labelledValues,
  startsWithLabel,
  tidyValue,
} from './fieldLabels.js';

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
  'certification',
  'licenses',
  'licenses and certifications',
  'courses',
  'training',
  'awards',
  'honors',
  'volunteer experience',
  'volunteering',
  'publications',
  'additional information',
  'activities',
  'strengths',
  'relevant skills',
  'core competencies',
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
  'relevant skills',
  'core competencies',
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

// PDFs often letter-space headings ("E D U CAT I O N", "K EY S K I L LS"), so a
// heading is also recognised with all its spaces removed.
const squeeze = (text) => text.replace(/\s+/g, '');
const HEADING_BY_SQUEEZED = new Map(SECTION_HEADINGS.map((h) => [squeeze(h), h]));
const headingKey = (line) => {
  const base = line
    .trim()
    .replace(/[:\-–—\s]+$/, '')
    .toLowerCase();
  return HEADING_SET.has(base) ? base : (HEADING_BY_SQUEEZED.get(squeeze(base)) ?? base);
};
const isHeading = (line) => line.trim().length <= 60 && HEADING_SET.has(headingKey(line));

const LABEL_LINE =
  /^\s*(?:full\s+name|name|phone(?:\s+number)?|mobile(?:\s+no\.?|\s+number)?|tel(?:ephone)?|contact(?:\s+no\.?|\s+number)?|e-?mail(?:\s+address)?|address|permanent\s+address|nic|date\s+of\s+birth|dob|nationality|gender|marital\s+status|linkedin|github|website)\s*[:\-–]/i;

// ---------------------------------------------------------------- placeholders

// Template text that stands in for a real value ("Your Name", your-name@email.com,
// (555) 555-5555). It is not the candidate's, so the field is left empty.
const PLACEHOLDER_EMAIL_LOCAL =
  /^(?:your[-._]?(?:name|email|e-?mail)|(?:first|firstname)[-._]?(?:last|lastname)|name|email|e-?mail|username|user|someone|example|sample|test|(?:john|jane)[-._]?doe)$/i;
// Only domains that exist purely as stand-ins. A real-looking name at a real
// provider (anusha.perera@email.com) is a value, not a template: what makes
// "your-name@email.com" a placeholder is its local part, tested above.
const PLACEHOLDER_EMAIL_DOMAIN =
  /^(?:example|domain|yourdomain|yourcompany|company|website|sample|test)\.(?:com|org|net)$/i;
const PLACEHOLDER_NAME =
  /^\[.*\]$|^(?:your|first|full|last|candidate|applicant)\s+(?:full\s+)?(?:name|surname)$|^(?:first\s*name\s+last\s*name|firstname\s+lastname|first\s+last|name\s+surname|(?:john|jane)\s+doe)$/i;
const PLACEHOLDER_ADDRESS =
  /\b(?:street\s+address|your\s+(?:street|city|address)|address\s+line|city,?\s+state(?:,?\s+zip)?|anytown)\b|^123\s+main\s+st/i;

function isPlaceholderEmail(email) {
  const [local, domain = ''] = email.split('@');
  return PLACEHOLDER_EMAIL_LOCAL.test(local) || PLACEHOLDER_EMAIL_DOMAIN.test(domain);
}

const isPlaceholderName = (name) => PLACEHOLDER_NAME.test(name.trim().replace(/\s+/g, ' '));

function isPlaceholderPhone(raw) {
  const digits = raw.replace(/\D/g, '');
  return (
    /^(\d)\1{6,}$/.test(digits) ||
    /(?:1234567890?|0123456789)$/.test(digits) ||
    /^\+?1?[\s.-]*\(?555\)?[\s.-]*\d{3}[\s.-]*\d{4}$/.test(raw.trim()) ||
    // 555 as the middle group, with the groups visibly separated: (123) 555-1234.
    /\d{3}(?:\)[\s.-]*|[\s.-]+)555[\s.-]+\d{4}/.test(raw)
  );
}

// ---------------------------------------------------------------- email

const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;

// "name [at] example [dot] com" is how some pages hide an address from robots.
const deobfuscate = (text) =>
  text
    .replace(/\s*[[(]\s*at\s*[\])]\s*/gi, '@')
    .replace(/(?<=[A-Za-z0-9-])\s*[[(]\s*dot\s*[\])]\s*(?=[A-Za-z0-9-])/gi, '.');

// The address behind a mailto: link ("mailto:a@b.com?subject=Hi" -> "a@b.com").
function mailtoAddress(link) {
  const match = /^mailto:([^?]+)/i.exec(link.trim());
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]).trim();
  } catch {
    return null;
  }
}

// An address cut in two by the layout: "name@" at the end of a line with the
// domain on the next, "name" then "@domain", a domain split after its dot, or
// "name @ domain" with spaces. The pieces are joined only where the result is
// an address; nothing is added that is not in the text.
function joinSplitAddresses(lines) {
  const out = [];
  for (let i = 0; i < lines.length; i += 1) {
    let line = lines[i];
    const next = lines[i + 1]?.trim() ?? '';
    if (/@\s*$/.test(line) && /^[A-Za-z0-9-]+\./.test(next)) {
      line = `${line.trimEnd()}${next}`;
      i += 1;
    } else if (
      /@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.\s*$/.test(line) &&
      /^[A-Za-z]{2,10}$/.test(next)
    ) {
      line = `${line.trimEnd()}${next}`;
      i += 1;
    } else if (
      /^@[A-Za-z0-9-]+\./.test(next) &&
      /(?:^|\s)[A-Za-z0-9._%+-]+$/.test(line) &&
      (!/\s/.test(line.trim()) || /e-?mail/i.test(line))
    ) {
      line = `${line.trimEnd()}${next}`;
      i += 1;
    }
    out.push(line.replace(/([A-Za-z0-9._%+-])[ \t]+@[ \t]*(?=[A-Za-z0-9-]+\.)/g, '$1@'));
  }
  return out;
}

// Letters run into the next word ("name@mail.comPhone: 077...") are cut off at
// the capital letter; a domain never has one in the middle of its last part.
function trimGluedWord(address) {
  const [local, domain] = address.split('@');
  const labels = domain.split('.');
  const last = labels.pop();
  const cut = /^([a-z]{2,})[A-Z]/.exec(last);
  return `${local}@${[...labels, cut ? cut[1] : last].join('.')}`;
}

// \`links\` are the addresses behind clickable words in the CV: a mailto: link
// counts the same as an address written in the text.
//
// Which address is the candidate's:
//   - addresses after a "References" heading are the referees', never used;
//   - a single address is used;
//   - with several, the one next to an "Email" label (or behind a mailto: link)
//     is used only if it is the only such address;
//   - otherwise nothing is filled and HR is shown the addresses to choose from.
function findEmail(text, links = []) {
  const allLines = joinSplitAddresses(deobfuscate(text).split('\n'));
  const own = beforeReferences(allLines);
  const found = [];
  const referees = new Set();
  let sawPlaceholder = false;
  const add = (raw, rank) => {
    const email = trimGluedWord(raw.replace(/[.]+$/, '')).toLowerCase();
    if (isPlaceholderEmail(email)) {
      sawPlaceholder = true;
      return;
    }
    const known = found.find((f) => f.email === email);
    if (known) known.rank = Math.max(known.rank, rank);
    else found.push({ email, rank });
  };
  for (const line of own) {
    for (const match of line.matchAll(EMAIL_PATTERN)) {
      add(match[0], /e-?mail/i.test(line.slice(0, match.index)) ? 2 : 1);
    }
  }
  for (const line of allLines.slice(own.length)) {
    for (const match of line.matchAll(EMAIL_PATTERN)) {
      referees.add(trimGluedWord(match[0].replace(/[.]+$/, '')).toLowerCase());
    }
  }
  for (const link of links) {
    const address = mailtoAddress(link);
    for (const match of address?.matchAll(EMAIL_PATTERN) ?? []) {
      if (!referees.has(match[0].toLowerCase())) add(match[0], 2);
    }
  }
  if (found.length === 0) {
    if (referees.size > 0) {
      return unavailable(
        'The only email address in the CV belongs to a referee, so it was not used.',
      );
    }
    return unavailable(
      sawPlaceholder
        ? 'The only email address is template text (such as your-name@email.com), so it was left empty.'
        : 'No email address was found in the CV.',
    );
  }
  if (found.length === 1) return available(found[0].email);

  const top = Math.max(...found.map((f) => f.rank));
  const best = found.filter((f) => f.rank === top);
  const others = found.filter((f) => f !== best[0]).map((f) => f.email);
  if (top === 2 && best.length === 1) {
    return {
      status: 'extracted',
      value: best[0].email,
      note: `More than one email address was found (${others.join(', ')} also). The one marked as the email is used; change it if needed.`,
      alternatives: others,
    };
  }
  return uncertain(
    found[0].email,
    `Several email addresses were found (${found.map((f) => f.email).join(', ')}). Enter the right one.`,
    found.map((f) => f.email),
  );
}

// ---------------------------------------------------------------- phone

// A run of digits with the separators people type, 9 to 15 digits in all.
const PHONE_PATTERN = /(?<![\w@/.-])(\+?\d(?:[\d\s\-().]{7,22}\d))(?![\w@])/g;

const digitsOf = (value) => value.replace(/\D/g, '');
const compact = (value) => value.replace(/[\s\-().]/g, '');

// Lines whose numbers are never the candidate's phone.
const NOT_A_PHONE_LINE =
  /\b(?:fax|n\.?i\.?c\.?|passport|id\s*(?:no|number)|postal|post\s*code|zip|candidate\s*id|reference\s*no|date\s*of\s*birth|d\.?o\.?b\.?)\b/i;

// Which part of the CV the lines before a "References" heading belong to: a
// referee's name and number are not the candidate's.
function beforeReferences(lines) {
  const end = lines.findIndex(
    (l) => /^(?:references?|referees?)$/.test(headingKey(l)) && isHeading(l),
  );
  return end === -1 ? lines : lines.slice(0, end);
}

function looksLikePhone(candidate) {
  const digits = digitsOf(candidate);
  if (digits.length < 9 || digits.length > 15) return false;
  // Two years such as "2019 - 2022", or a date such as 12.03.2001.
  if (/^(?:19|20)\d{2}\D+(?:19|20)\d{2}$/.test(candidate.trim())) return false;
  if (/^\d{1,2}[./-]\d{1,2}[./-]\d{2,4}$/.test(candidate.trim())) return false;
  return true;
}

// How trustworthy a number is as the candidate's main contact number.
//   labelled mobile 4, labelled phone/contact 3, unlabelled mobile-shaped 3,
//   unlabelled landline-shaped 2, labelled home/office/land line 1.
// An unlabelled number must also be written the way phone numbers are (a
// leading +, 0 or 94), so ID numbers and other digit runs are not taken.
function rankPhone(value, labelBefore) {
  const tidy = compact(value);
  const phoneShaped = /^(?:\+\d{9,14}|0\d{8,14}|94\d{9,13})$/.test(tidy);
  const mobileShaped = /^(?:\+94|0|94)7\d{8}$/.test(tidy);
  // A national number written with its own punctuation, (806) 625-9669 or
  // 806-625-9669: the punctuation is what shows it is a phone number.
  const punctuated = /^\d{3}(?:\)\s?|[-.\s])\d{3}[-.\s]\d{4}$/.test(value.trim());
  const label = labelBefore.toLowerCase();
  if (/home|office|land\s*line|landline|work/.test(label)) return phoneShaped || punctuated ? 1 : 0;
  if (/mobile|cell|whats\s*app/.test(label)) return 4;
  if (/phone|tel|contact|call/.test(label)) return 3;
  if (!phoneShaped) return punctuated ? 2 : 0;
  return mobileShaped ? 3 : 2;
}

// A line that is only a phone label ("Phone", "Mobile:"), with the number on the
// next line.
const PHONE_LABEL_ONLY =
  /^\s*(?:phone(?:\s+(?:no\.?|number))?|mobile(?:\s+(?:no\.?|number))?|tel(?:ephone)?|contact(?:\s+(?:no\.?|number))?|cell|whats\s*app)\s*[:\-–]?\s*$/i;

// The number behind a tel: link ("tel:+94 70 000 0001").
function telNumber(link) {
  const match = /^tel:(.+)$/i.exec(link.trim());
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]).split(/[;,]/)[0].trim();
  } catch {
    return null;
  }
}

// Every number found, best first: a labelled mobile, then other labelled or
// phone-shaped numbers, in reading order within the same rank. The first is the
// main number (Phone Number 1); the next one is offered as Phone Number 2.
function findPhone(allLines, links = []) {
  const lines = beforeReferences(allLines);
  const found = [];
  let sawPlaceholder = false;
  for (const link of links) {
    const value = telNumber(link);
    const key = value && digitsOf(value).slice(-9);
    if (!value || !looksLikePhone(value) || isPlaceholderPhone(value)) continue;
    if (!found.some((f) => digitsOf(f.value).slice(-9) === key)) found.push({ value, rank: 4 });
  }
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (NOT_A_PHONE_LINE.test(line)) continue;
    for (const m of line.matchAll(PHONE_PATTERN)) {
      const value = m[1].trim();
      if (!looksLikePhone(value)) continue;
      // The label is on this line before the number, or alone on the line above.
      // Template numbers are recognised whatever their label, so they are
      // reported as template text rather than as "no phone found".
      if (isPlaceholderPhone(line.slice(Math.max(0, m.index - 1), m.index + m[0].length))) {
        sawPlaceholder = true;
        continue;
      }
      const before = line.slice(0, m.index).replace(/[\s(]+$/, '');
      const labelAbove = !before && i > 0 && PHONE_LABEL_ONLY.test(lines[i - 1]);
      const rank = rankPhone(value, labelAbove ? lines[i - 1] : line.slice(0, m.index).slice(-24));
      if (rank === 0) continue;
      const key = digitsOf(value).slice(-9);
      if (!found.some((f) => digitsOf(f.value).slice(-9) === key)) found.push({ value, rank });
    }
  }
  if (found.length === 0) {
    return unavailable(
      sawPlaceholder
        ? 'The only phone number is template text, so it was left empty.'
        : 'No phone number was found in the CV.',
    );
  }

  const ordered = found
    .map((f, index) => ({ ...f, index }))
    .sort((a, b) => b.rank - a.rank || a.index - b.index)
    .map((f) => f.value);
  if (ordered.length === 1) return available(ordered[0]);
  return {
    status: 'extracted',
    value: ordered[0],
    note: `Several phone numbers were found (${ordered.join(', ')}). The first is Phone Number 1 and the second is Phone Number 2.`,
    alternatives: ordered.slice(1),
  };
}

// ---------------------------------------------------------------- name

// Words that mean a line is a heading, a sentence, a job title, or an
// organisation, and so cannot be a person's name.
const NOT_NAME_WORDS = new Set(
  (
    'curriculum vitae resume cv profile personal details information contact address email phone ' +
    'by example sample template genius ' +
    'mobile tel objective summary page references education skills experience projects languages ' +
    'interests declaration for in at the a an of and to with looking seeking i am my is are on ' +
    'from by as or this that experienced highly motivated skilled passionate dedicated'
  ).split(' '),
);
const JOB_WORDS =
  /\b(?:developer|engineer|manager|officer|analyst|designer|intern|internship|student|tester|consultant|administrator|executive|assistant|programmer|architect|specialist|technician|coordinator|director|lecturer|graduate|undergraduate|trainee|accountant|clerk|supervisor|associate|software|web|data|senior|junior|lead|full[- ]?stack|front[- ]?end|back[- ]?end)\b/i;
const ORG_WORDS =
  /\b(?:university|institute|college|school|campus|academy|company|corporation|corp|ltd|limited|pvt|private|plc|inc|llc|technologies|technology|solutions|systems|services|holdings|group|bank|hospital|international|enterprises|association|society|department|faculty|vidyalaya)\b/i;
const TITLE_PREFIX = /^(?:mr|mrs|ms|miss|dr|eng|rev)\.?\s+/i;

// Shape of a person's name: 2 to 5 words made of letters, in any case.
// `strict` also refuses headings, job titles, organisations and sentences,
// which is needed when nothing labels the line as a name.
function looksLikeName(line, { strict }) {
  const text = line.trim();
  if (text.length < 3 || text.length > 60) return false;
  if (/[\d@:/\\|]/.test(text) || isHeading(text)) return false;
  if (isPlaceholderName(text.replace(TITLE_PREFIX, ''))) return false;
  const words = text.replace(TITLE_PREFIX, '').split(/\s+/);
  if (words.length < 2 || words.length > 5) return false;
  if (!words.every((w) => /^[\p{L}][\p{L}.'’-]*$/u.test(w))) return false;
  if (!strict) return true;
  // A lone letter with a full stop is an initial (A. B. Perera), not the word "a".
  const isInitial = (w) => /^\p{L}\.$/u.test(w);
  if (words.some((w) => !isInitial(w) && NOT_NAME_WORDS.has(w.toLowerCase()))) return false;
  // A word ending in a full stop is the end of a sentence, not part of a name
  // (the last words of a wrapped paragraph: "production projects.").
  if (words.some((w) => !isInitial(w) && /[.,;]$/.test(w))) return false;
  return !JOB_WORDS.test(text) && !ORG_WORDS.test(text);
}

const sameName = (a, b) =>
  a.toLowerCase().replace(/\s+/g, ' ') === b.toLowerCase().replace(/\s+/g, ' ');
const tidyName = (value) => value.trim().replace(/\s+/g, ' ');

// The part of a header line before a separator, so "ANUSHA PERERA | 0771234567"
// still yields the name.
const HEADER_SEPARATOR = /\s*(?:\||•|·|–|—)\s*|\s+-\s+/;
const firstSegment = (line) => line.split(HEADER_SEPARATOR)[0];

function findName(allLines) {
  const lines = beforeReferences(allLines);

  // 1. Explicit "Name:" labels (or a lone "Name" line with the value below).
  // Two different names are a genuine conflict.
  const labelled = [];
  for (let i = 0; i < lines.length; i += 1) {
    const m = lines[i].match(/^\s*(?:full\s+)?name(?:\s+in\s+full)?\s*[:\-–]\s*(.+)$/i);
    const aloneAbove = /^\s*(?:full\s+)?name\s*[:\-–]?\s*$/i.test(lines[i]);
    const below = lines[i + 1];
    const raw = m?.[1] ?? (aloneAbove && below && !isBareLabel(below) ? below : null);
    if (!raw) continue;
    const value = tidyName(firstSegment(raw));
    if (looksLikeName(value, { strict: false }) && !labelled.some((n) => sameName(n, value))) {
      labelled.push(value);
    }
  }

  if (labelled.length === 1) return available(labelled[0]);
  if (labelled.length > 1) {
    return uncertain(
      null,
      `More than one name was found (${labelled.join(', ')}). Enter the right one.`,
      labelled,
    );
  }

  // 2. No label: the first lines of the CV, then the personal-details section.
  const meaningful = lines.filter((l) => l.trim());
  const top = [];
  // A title on the same line as the name ("ANUSHA PERERA Software Developer")
  // is not part of the name.
  const nameOf = (line) => {
    const value = tidyName(firstSegment(line));
    return splitNameAndRole(value)?.name ?? value;
  };
  for (const line of meaningful.slice(0, 8)) {
    const value = nameOf(line);
    if (looksLikeName(value, { strict: true }) && !top.some((n) => sameName(n, value))) {
      top.push(value);
    }
  }
  if (top.length > 0) {
    // The very first line of a CV is the name when it reads as one; otherwise
    // two name-like lines are ambiguous and are left for HR.
    const firstIsName = sameName(nameOf(meaningful[0] ?? ''), top[0]);
    if (top.length === 1 || firstIsName) return available(top[0]);
    return uncertain(
      null,
      `More than one name was found (${top.join(', ')}). Enter the right one.`,
      top,
    );
  }

  const personal = lines.findIndex(
    (l) =>
      isHeading(l) &&
      /^(?:personal (?:details|information)|contact(?: details)?|profile)$/.test(headingKey(l)),
  );
  if (personal !== -1) {
    for (const line of lines.slice(personal + 1, personal + 5)) {
      const value = tidyName(firstSegment(line));
      if (looksLikeName(value, { strict: true })) return available(value);
    }
  }
  const templateName = lines
    .filter((l) => l.trim())
    .slice(0, 8)
    .some((l) => isPlaceholderName(tidyName(firstSegment(l))));
  return unavailable(
    templateName
      ? 'The name is template text (such as "Your Name"), so it was left empty.'
      : 'No name was found in the CV.',
  );
}

// ---------------------------------------------------------------- hints

// Things the CV may state outright that match a dropdown on the form (the
// Applied Position and the Source). Only the stated text is returned; the form
// accepts it only if it equals an existing, active option.
// `labelOnly` matches a line that is just a label ("Applied Position"), whose
// value is then the next line, as laid out in Word tables and forms.
function findHint(lines, patterns, { labelOnly = null, maxWords = 12 } = {}) {
  const usable = beforeReferences(lines);
  const clean = (text) => tidyName(text).replace(/[.;,]+$/, '');
  const fits = (value) => value && value.length <= 100 && value.split(' ').length <= maxWords;
  for (let i = 0; i < usable.length; i += 1) {
    const line = usable[i];
    for (const pattern of patterns) {
      const m = line.match(pattern);
      const value = m?.[1] && clean(m[1]);
      if (fits(value)) return value;
    }
    const next = usable[i + 1]?.trim();
    if (
      labelOnly?.test(line) &&
      next &&
      !isHeading(next) &&
      !startsWithLabel(next) &&
      !isBareLabel(next)
    ) {
      const value = clean(next);
      if (fits(value)) return value;
    }
  }
  return null;
}

// An applied position the CV states outright: a label ("Position Applied For:
// QA Intern") or a sentence ("I am applying for the position of QA Intern at
// Example Ltd"). Nothing about past jobs belongs here.
const POSITION_LABEL = String.raw`(?:applied\s+(?:position|post|role)|(?:position|post|role|job|vacancy)\s+(?:applied|applying)(?:\s+for)?|applying\s+for(?:\s+the\s+(?:post|position|role)\s+of)?|applied\s+for(?:\s+the\s+(?:post|position|role)(?:\s+of)?)?)`;
// With a colon or dash, or just a space ("Applied Position  Software Developer").
const POSITION_PATTERNS = [
  // (?!for\b) keeps "Position Applied For" with nothing after it from reading
  // its own last word as the position.
  new RegExp(String.raw`^\s*${POSITION_LABEL}(?:\s*[:\-–]\s*|\s+(?!(?:for|of)\b))(.+)$`, 'i'),
  /\b(?:application\s+for|appl(?:y|ying|ied)\s+for)\s+the\s+(?:post|position|role|vacancy)\s+of\s*[:\-–]?\s*(.+?)(?=\s+(?:at|with|in|on|advertised)\b|[.,;]|$)/i,
];

// The role a CV aims at without saying it is the one applied for: a labelled
// target ("Desired Position: QA Intern") or a career-objective sentence
// ("Seeking a position as a QA Intern"). Only a suggestion for HR, and never
// read from work experience, skills or projects.
const TARGET_LABEL_PATTERNS = [
  /^\s*(?:target(?:ed)?|desired|preferred|intended)\s+(?:position|post|role|job(?:\s+title)?|designation)\s*[:\-–]\s*(.+)$/i,
  /^\s*(?:position|post|role)\s+sought\s*[:\-–]\s*(.+)$/i,
  // A bare label in the header (not under experience, which is skipped): the
  // role the CV names for itself.
  /^\s*(?:position|post|designation|job\s+title|role)\s*[:\-–]\s*(.+)$/i,
];
const OBJECTIVE_STOP = String.raw`(?=\s+(?:at|with|in|where|that|to|and|for|within)\b|[.,;]|$)`;
const TARGET_SENTENCE_PATTERNS = [
  new RegExp(
    String.raw`\b(?:seeking|looking\s+for|to\s+obtain|to\s+secure|to\s+pursue)\b[^.]*?\b(?:position|post|role|job|internship|opportunity)\s+(?:as|of)\s+(?:an?\s+|the\s+)?([A-Za-z0-9/&+ -]{2,50}?)` +
      OBJECTIVE_STOP,
    'i',
  ),
  new RegExp(
    String.raw`\bto\s+work\s+as\s+(?:an?\s+|the\s+)?([A-Za-z0-9/&+ -]{2,50}?)` + OBJECTIVE_STOP,
    'i',
  ),
  // "Seeking a Software Developer role in a dynamic team"
  new RegExp(
    String.raw`\b(?:seeking|looking\s+for)\s+(?:an?\s+|the\s+)?([A-Za-z0-9/&+ -]{2,50}?)\s+(?:position|role|post|job)\b`,
    'i',
  ),
];
// Words that describe a job without naming it ("a challenging position").
const NOT_A_ROLE =
  /^(?:challenging|suitable|good|new|responsible|rewarding|permanent|full[- ]?time|part[- ]?time|entry[- ]level|similar|relevant)$/i;

// A job title written directly under the name (or after it: "ANUSHA PERERA |
// Software Developer"), which is how a CV states the role it aims at. It must
// be a short phrase that names a role, with nothing else on the line.
const ROLE_NOUN =
  /\b(?:developer|engineer|manager|officer|analyst|designer|intern|trainee|tester|consultant|administrator|executive|assistant|programmer|architect|specialist|technician|coordinator|director|accountant|clerk|supervisor|recruiter)\b/i;

// Is this text a short job title that says nothing else?
function isPlainRoleTitle(text) {
  const words = text.split(' ');
  if (words.length > 5 || /[\d@:/\\,]/.test(text.replace(/\bUI\/UX\b/i, ''))) return false;
  if (isHeading(text) || ORG_WORDS.test(text)) return false;
  // A line that says what it is (a label or a sentence) is not a plain title.
  if (
    /^(?:applied|applying|apply|position|post|role|job|vacancy|objective|seeking|looking)\b/i.test(
      text,
    )
  ) {
    return false;
  }
  return words.every((w) => /^[\p{L}&+.-]+$/u.test(w)) && ROLE_NOUN.test(text);
}

// A title written after the name on the same line with nothing between them
// ("ANUSHA PERERA Software Developer"): the shortest ending that is a title,
// when what comes before it reads as a person's name.
function splitNameAndRole(text) {
  const words = text.split(' ');
  for (let take = 1; take <= Math.min(4, words.length - 2); take += 1) {
    const title = words.slice(-take).join(' ');
    const name = words.slice(0, -take).join(' ');
    if (isPlainRoleTitle(title) && looksLikeName(name, { strict: true })) return { name, title };
  }
  return null;
}
const roleAfterName = (text) => splitNameAndRole(text)?.title ?? null;

// The role a CV states at the top: a job title after the name, under it, or
// further down the header (after the contact lines). It stops at the first
// section that is about the past (experience, education, skills ...).
// A line that names the document, not a job: "NETWORK ENGINEER RESUME",
// "Example by Resume Genius", "CV".
const DOCUMENT_TITLE = /\b(?:resume|r[eé]sum[eé]|cv|curriculum vitae|example|sample|template)\b/i;

function findHeadlineRole(allLines) {
  const meaningful = beforeReferences(allLines).filter((l) => l.trim());
  let seen = 0;
  for (let i = 0; i < meaningful.length; i += 1) {
    const line = meaningful[i];
    if (isHeading(line) && NOT_TARGET_SECTIONS.has(headingKey(line))) break;
    seen += 1;
    if (seen > 12) break;
    // A title split over lines ("BRANCH" / "MANAGER" / "RESUME") is the
    // document's title, not the candidate's role.
    const near = [meaningful[i - 1], line, meaningful[i + 1]].filter(Boolean);
    if (near.some((l) => DOCUMENT_TITLE.test(l) && l.trim().split(/\s+/).length <= 4)) continue;
    for (const segment of line.split(HEADER_SEPARATOR)) {
      const text = tidyName(segment);
      // "NAME Title" first, so a name is never carried into the title.
      const after = roleAfterName(text);
      if (after) return after;
      if (isPlainRoleTitle(text)) return text;
    }
  }
  return null;
}

const NOT_TARGET_SECTIONS = new Set([...UNMAPPED_HEADINGS, 'education', 'references', 'referees']);

function findTargetPosition(allLines) {
  let section = null;
  for (const line of beforeReferences(allLines)) {
    if (isHeading(line)) {
      section = headingKey(line);
      continue;
    }
    if (section && NOT_TARGET_SECTIONS.has(section)) continue;
    for (const pattern of [...TARGET_LABEL_PATTERNS, ...TARGET_SENTENCE_PATTERNS]) {
      const value =
        line.match(pattern)?.[1] && tidyName(line.match(pattern)[1]).replace(/[.;,]+$/, '');
      if (value && value.length <= 60 && !NOT_A_ROLE.test(value)) return value;
    }
  }
  return findHeadlineRole(allLines);
}
const SOURCE_PATTERNS = [
  /^\s*(?:application\s+source|source(?:\s+of\s+application)?)\s*[:\-–]\s*(.+)$/i,
  /^\s*(?:applied\s+(?:through|via)|heard\s+about\s+(?:us|this\s+job)\s+(?:from|through|via))\s*[:\-–]?\s*(.+)$/i,
];

// ---------------------------------------------------------------- address

// A line that starts something other than the rest of an address: a
// qualification, an exam heading, or a phone number.
const notAnAddressLine = (line) =>
  HIGHER_EDU.test(line) ||
  OL_HEAD.test(line) ||
  AL_HEAD.test(line) ||
  [...line.matchAll(PHONE_PATTERN)].some((m) => looksLikePhone(m[1]));
const startsNewItem = (line) => isHeading(line) || notAnAddressLine(line);

// The address value ends where another field begins: on the same line
// ("Address: 12 Lane, Colombo, O/L Maths A") or on a following line. Education
// and contact details are never part of an address.
// An address written in the header with no "Address" label: a street line
// ("189 Main Street, Pampa, TX 79065", or "880 N Alameda St, Los" with the rest
// on the next line) or a city, state and ZIP. Only the top of the CV is read, up
// to the first section that is about something else, so work addresses further
// down are never taken.
const STREET =
  /^\d{1,6}[A-Za-z]?\s+(?:[A-Za-z0-9'.-]+\s+){0,5}(?:St|Street|Rd|Road|Ave|Avenue|Blvd|Boulevard|Ln|Lane|Dr|Drive|Way|Ct|Court|Pl|Place|Mawatha|Hwy|Highway|Terrace|Trail)\b\.?/i;
const CITY_STATE_ZIP = /^[A-Z][\p{L} .'-]+,\s*[A-Z]{2}\s+\d{5}(?:-\d{4})?$/u;

function findHeaderAddress(allLines) {
  const header = [];
  for (const line of beforeReferences(allLines)) {
    if (!line.trim()) continue;
    if (
      isHeading(line) &&
      !/^(?:contact(?: details)?|personal (?:details|information)|profile)$/.test(headingKey(line))
    )
      break;
    header.push(line);
    if (header.length >= 14) break;
  }

  for (let i = 0; i < header.length; i += 1) {
    for (const segment of header[i].split(/\s*(?:\||•|·)\s*/)) {
      const text = tidyName(segment);
      if (!STREET.test(text)) continue;
      // The city, state and ZIP may be on the next line, or the street itself may
      // have wrapped ("... St, Los" / "Angeles, CA 90012").
      const next = tidyName(header[i + 1] ?? '');
      let address = text;
      if (
        !CITY_STATE_ZIP.test(text) &&
        !/\b[A-Z]{2}\s+\d{5}\b/.test(text) &&
        CITY_STATE_ZIP.test(next)
      ) {
        address = `${text}${text.includes(',') ? ' ' : ', '}${next}`;
      }
      if (PLACEHOLDER_ADDRESS.test(address)) return null;
      return address.replace(/[,;\s]+$/, '');
    }
  }
  return null;
}

function findAddress(allLines, wrapped) {
  const lines = wrapped ? joinWrappedLines(allLines, startsNewItem) : allLines;
  for (let i = 0; i < lines.length; i += 1) {
    const m = lines[i].match(
      /^\s*(?:permanent\s+|postal\s+|current\s+|home\s+|residential\s+|mailing\s+)?address\s*[:\-–]?\s*(.*)$/i,
    );
    if (!m) continue;
    const rest = m[1].trim();
    const first = tidyValue(beforeFirstLabel(rest));
    const parts = first ? [first] : [];
    const stoppedOnLine = beforeFirstLabel(rest) !== rest; // another field starts here

    // The address may continue on the lines below, up to a blank line, a
    // field label, a section heading, or a line that is not address text.
    for (let j = i + 1; j < lines.length && parts.length < 4 && !stoppedOnLine; j += 1) {
      const next = lines[j].trim();
      if (!next || LABEL_LINE.test(next) || startsWithLabel(next) || isBareLabel(next)) break;
      if (isHeading(next)) break;
      if (next.includes('@')) break;
      const before = tidyValue(beforeFirstLabel(next));
      if (!before || notAnAddressLine(before)) break;
      // A continuation is a short address line. A sentence, or a second street
      // address, is something else.
      if (
        before.split(/\s+/).length > 8 ||
        (STREET.test(before) && parts.some((p) => STREET.test(p)))
      ) {
        break;
      }
      parts.push(before);
      if (beforeFirstLabel(next) !== next) break; // another field starts inside this line
    }
    if (parts.length === 0) continue;
    const value = parts
      .join(', ')
      .replace(/,\s*,/g, ',')
      .replace(/[,;\s]+$/, '');
    if (PLACEHOLDER_ADDRESS.test(value)) {
      return unavailable('The address is template text, so it was left empty.');
    }
    return available(value);
  }
  const header = findHeaderAddress(allLines);
  if (header) return available(header);
  return unavailable('No address was found in the CV.');
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

// Education fields written with their own label anywhere in the CV, with or
// without an Education heading and several to a line: "O/L Maths A, A/L Result
// 3 A passes". Returns the values found for each field, as written.
function scanEducationLabels(allLines, wrapped) {
  const before = beforeReferences(allLines);
  const lines = wrapped ? joinWrappedLines(before, startsNewItem) : before;
  const found = { olMaths: [], alResult: [], alStream: [], otherEducation: [] };
  for (let i = 0; i < lines.length; i += 1) {
    const values = labelledValues(lines[i]);
    values.forEach(({ name, value }, index) => {
      if (!(name in found)) return;
      let text = value;
      // A label that ends its line takes the next line as its value.
      const next = lines[i + 1]?.trim();
      if (
        !text &&
        index === values.length - 1 &&
        next &&
        !startsWithLabel(next) &&
        !isBareLabel(next) &&
        !isHeading(next)
      ) {
        text = tidyValue(beforeFirstLabel(next));
      }
      if (text) found[name].push(text);
    });
  }
  return found;
}

const distinct = (values) => {
  const seen = new Map();
  for (const v of values) if (!seen.has(v.toLowerCase())) seen.set(v.toLowerCase(), v);
  return [...seen.values()];
};

const AMBIGUOUS = (what, values) =>
  uncertain(
    null,
    `More than one ${what} was found (${values.join(', ')}). Enter the right one.`,
    values,
  );

// The field's value from labelled text, or null when the CV has no such label
// (so the section-based reading can still be tried).
function labelledOlMaths(values) {
  if (values.length === 0) return null;
  const grades = distinct(values.map((v) => v.match(/^([ABCSW])(?![\w/.])/)?.[1]).filter(Boolean));
  if (grades.length === 1 && values.every((v) => /^[ABCSW](?![\w/.])/.test(v))) {
    return available(grades[0]);
  }
  if (grades.length > 1) return AMBIGUOUS('O/L Maths grade', grades);
  return uncertain(null, `The O/L Maths grade is unclear ("${values[0]}"). Enter the grade.`);
}

function labelledText(values, what) {
  if (values.length === 0) return null;
  const all = distinct(values);
  if (all.length > 1) return AMBIGUOUS(what, all);
  if (all[0].length > 100) {
    return uncertain(null, `The ${what} is unusually long ("${all[0].slice(0, 40)}…"). Enter it.`);
  }
  return available(all[0]);
}

const INSTITUTION =
  /\b(?:university|college|institute|school|academy|campus|polytechnic|vidyalaya)\b/i;
// A year, or month and year, or a range, standing alone on its line.
const DATE_ONLY =
  /^(?:[A-Za-z]{3,9}\.?\s+)?(?:19|20)\d{2}(?:\s*[–-]\s*(?:(?:[A-Za-z]{3,9}\.?\s+)?(?:19|20)\d{2}|present))?$/i;
const PLACE_ONLY = /^[A-Z][\p{L} .'-]+,\s*[A-Z]{2}$/u;
// A year that is still template text ("20XX").
const TEMPLATE_YEAR = /\b(?:19|20)XX\b/i;

// Each degree, diploma, school or college entry in an education section, with
// what belongs to it: its institution, place and dates, whichever order they
// are written in ("Stark State College" then "Bachelor of Science", or the
// other way round). An entry holds at most one degree and one institution; a
// second of either starts the next entry. Lines that are none of these (a
// grade, a certification) end the entry and are left out.
function educationEntries(lines) {
  const entries = [];
  let current = null;
  const finish = () => {
    if (current && (current.degree || current.institution)) entries.push(current.parts);
    current = null;
  };

  let previous = '';
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || TEMPLATE_YEAR.test(line)) continue;
    if (isHeading(line) || startsWithLabel(line) || line.includes('@') || line.length > 110) {
      finish();
      previous = '';
      continue;
    }
    const isDegree = HIGHER_EDU.test(line);
    const isInstitution = INSTITUTION.test(line);
    const continues = /[,(]$|\b(?:in|of|and|with|at)$/i.test(previous) || /^[a-z(]/.test(line);

    let kind = null;
    if (isDegree || isInstitution) kind = 'main';
    else if (DATE_ONLY.test(line)) kind = 'date';
    else if (PLACE_ONLY.test(line)) kind = 'place';
    else if (current && continues) kind = 'continuation';

    if (!kind) {
      finish();
      previous = '';
      continue;
    }
    if (kind === 'main') {
      const startsNew =
        current && ((isDegree && current.degree) || (isInstitution && current.institution));
      if (startsNew) finish();
    }
    if (!current) current = { parts: [], degree: false, institution: false };
    if (kind === 'main') {
      current.degree ||= isDegree;
      current.institution ||= isInstitution;
    }
    current.parts.push(line);
    previous = line;
  }
  finish();

  // Parts are joined with a comma, except where the text plainly runs on
  // ("Associate of Arts in" / "Management"). Table dividers (|) are dropped.
  return entries.map((parts) =>
    parts
      .map((part) => part.replace(/[\s|•·]+$/, '').trim())
      .reduce((text, part) => {
        if (!text) return part;
        const runsOn = /[,(]$/.test(text) || /\b(?:in|of|and|with|at)$/i.test(text);
        return runsOn ? `${text} ${part}` : `${text}, ${part}`;
      }, ''),
  );
}

function findOtherEducation(groups, sectionLines, labelled = []) {
  const own = sectionLines.length ? groups.other : [];
  const entries = educationEntries(own);
  const sectionLabelled = groups.other
    .map((l) => l.match(/^other\s+education\s*[:\-–]\s*(.+)$/i)?.[1])
    .filter(Boolean);
  const all = [...new Set([...labelled, ...sectionLabelled, ...entries])];
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

export function extractFields(text, { wrapped = false, links = [] } = {}) {
  const lines = text.split('\n');
  const section = educationSection(lines);
  const groups = groupEducation(section);
  const sectionAl = findAl(groups.al);
  const labelled = scanEducationLabels(lines, wrapped);

  return {
    fields: {
      fullName: findName(lines),
      phone: findPhone(lines, links),
      email: findEmail(text, links),
      address: findAddress(lines, wrapped),
      olMaths: labelledOlMaths(labelled.olMaths) ?? findOlMaths(groups.ol, section.length > 0),
      alResult: labelledText(labelled.alResult, 'A/L Result') ?? sectionAl.alResult,
      alStream: labelledText(labelled.alStream, 'A/L Stream') ?? sectionAl.alStream,
      otherEducation: findOtherEducation(groups, section, labelled.otherEducation),
    },
    hints: {
      appliedPosition: findHint(lines, POSITION_PATTERNS, {
        labelOnly: new RegExp(String.raw`^\s*${POSITION_LABEL}\s*[:\-–]?\s*$`, 'i'),
        maxWords: 6,
      }),
      targetPosition: findTargetPosition(lines),
      // "Source" alone on a line (a table cell) takes the next line.
      source: findHint(lines, SOURCE_PATTERNS, {
        labelOnly: /^\s*(?:application\s+source|source)\s*:?\s*$/i,
      }),
    },
    unmappedSections: findUnmappedSections(lines),
    educationSectionFound: section.length > 0,
  };
}
