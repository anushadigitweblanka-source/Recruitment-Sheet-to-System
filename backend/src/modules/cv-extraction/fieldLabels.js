// Finds the field labels written inside a line of CV text, so one line that
// holds several fields ("Address: 12 Lane, Colombo, O/L Maths A, A/L Stream
// Physical Science") can be cut into its parts, and a value stops where the
// next field starts.
//
// Two kinds of label:
//   - education labels (O/L Maths, A/L Result, A/L Stream, Other Education) are
//     distinctive, so they count even without a colon: "O/L Maths A".
//   - other labels (Address, Phone, Email, Name, NIC ...) are ordinary words
//     that also occur inside addresses, so they count only when followed by a
//     colon or a spaced dash: "Phone: 077...".

const EDUCATION_LABELS = [
  ['olMaths', /(?:O\s?\/\s?L|O\.\s?L\.?|Ordinary\s+Level)\s+(?:Maths?|Mathematics)\b/gi],
  ['alResult', /(?:A\s?\/\s?L|A\.\s?L\.?|Advanced\s+Level)\s+Results?\b/gi],
  ['alStream', /(?:A\s?\/\s?L|A\.\s?L\.?|Advanced\s+Level)\s+Stream\b/gi],
  ['otherEducation', /Other\s+Education\b/gi],
];

// A colon or spaced dash after the label, or the label ending its line
// ("Address" alone, with the value on the next line).
const SEP = String.raw`(?=\s*:|\s+[-–]\s|\s*$)`;

const SEPARATED_LABELS = [
  [
    'address',
    new RegExp(
      String.raw`(?:(?:permanent|postal|current|home|residential|mailing)\s+)?address` + SEP,
      'gi',
    ),
  ],
  ['name', /(?:full\s+)?name(?:\s+in\s+full)?(?=\s*:|\s+[-–]\s)/gi],
  [
    'phone',
    new RegExp(
      String.raw`(?:phone|mobile|tel(?:ephone)?|contact|cell|whats\s*app)(?:\s+(?:no\.?|number))?` +
        SEP,
      'gi',
    ),
  ],
  // "Phone 0771234567": a number straight after the word.
  ['phone', /(?:phone|mobile|tel(?:ephone)?)(?:\s+(?:no\.?|number))?(?=\s+\+?\(?\d{2,})/gi],
  ['email', new RegExp(String.raw`e-?mail(?:\s+address)?` + SEP, 'gi')],
  // "Email name@example.com": an address straight after the word.
  ['email', /e-?mail(?:\s+address)?(?=\s+[\w.+-]+@)/gi],
  [
    'other',
    new RegExp(
      String.raw`(?:nic|n\.i\.c\.?|date\s+of\s+birth|dob|nationality|gender|marital\s+status|civil\s+status|religion)` +
        SEP,
      'gi',
    ),
  ],
  // These words are also values ("Source: LinkedIn"), so they are labels only
  // with a colon or dash, never when they merely end a line.
  ['other', /(?:linkedin|github|website)(?=\s*:|\s+[-–]\s)/gi],
];

// What may sit between a label and its value.
const AFTER_LABEL = /^\s*[:\-–=]?\s*/;
// Punctuation that separates one field from the next.
const EDGE = /^[\s,;|•·\-–]+|[\s,;|•·\-–]+$/g;

// Every label in the line, in order: [{ name, start, end }], where `end` is
// where the label's value begins.
export function findLabels(line) {
  const found = [];
  for (const [name, pattern] of [...EDUCATION_LABELS, ...SEPARATED_LABELS]) {
    for (const m of line.matchAll(new RegExp(pattern.source, pattern.flags))) {
      // Not the tail of a longer word or path ("tel" in "hotel").
      if (m.index > 0 && /[\w/]/.test(line[m.index - 1])) continue;
      const after = line.slice(m.index + m[0].length).match(AFTER_LABEL)[0].length;
      found.push({ name, start: m.index, end: m.index + m[0].length + after });
    }
  }
  found.sort((a, b) => a.start - b.start || b.end - a.end);
  // A label that starts inside an earlier one is part of it, not a new label.
  const kept = [];
  for (const label of found) {
    if (!kept.length || label.start >= kept[kept.length - 1].end) kept.push(label);
  }
  return kept;
}

export const startsWithLabel = (line) => findLabels(line.trim())[0]?.start === 0;

// Trims the separators around a value cut out of a line.
export const tidyValue = (value) => value.replace(EDGE, '').replace(/\s+/g, ' ');

// The text of `line` before its first label (the whole line if it has none).
export function beforeFirstLabel(line) {
  const first = findLabels(line)[0];
  return first ? line.slice(0, first.start) : line;
}

// The labelled values in a line: [{ name, value }]. A value runs from its
// label to the next label, so several fields on one line are each kept apart.
export function labelledValues(line) {
  const labels = findLabels(line);
  return labels.map((label, i) => ({
    name: label.name,
    value: tidyValue(line.slice(label.end, labels[i + 1]?.start ?? line.length)),
  }));
}

const MIN_WRAPPED_LINE = 60;
const EDUCATION_NAMES = new Set(EDUCATION_LABELS.map(([name]) => name));
const PARTIAL_LABEL_AT_END = /(?:A\s?\/\s?L|O\s?\/\s?L|Advanced\s+Level|Ordinary\s+Level)\s*$/i;

// A PDF breaks a long line where the page ends, so a label or its value can
// continue on the next line ("... A/L" then "Result 3 A passes"). Those pieces
// are joined before labels are read, but only when
//   - the line holds education labels (or ends in half of one),
//   - it runs to the full width of the page (as wide as the document's widest
//     lines), which is what a wrapped line looks like, and
//   - the next line does not start something new (a label, a heading, a
//     qualification), as decided by `startsNewItem`.
// Word files keep each paragraph on one line, so they are never joined.
export function joinWrappedLines(lines, startsNewItem) {
  const widest = Math.max(0, ...lines.map((line) => line.trim().length));
  const wide = Math.max(MIN_WRAPPED_LINE, Math.floor(widest * 0.85));
  const out = [];
  for (let i = 0; i < lines.length; i += 1) {
    let current = lines[i];
    let piece = lines[i];
    while (
      i + 1 < lines.length &&
      piece.trim().length >= wide &&
      (PARTIAL_LABEL_AT_END.test(piece) ||
        findLabels(piece).some((label) => EDUCATION_NAMES.has(label.name))) &&
      lines[i + 1].trim() &&
      !startsWithLabel(lines[i + 1]) &&
      !startsNewItem(lines[i + 1])
    ) {
      piece = lines[i + 1];
      current = `${current.trimEnd()} ${piece.trim()}`;
      i += 1;
    }
    out.push(current);
  }
  return out;
}

// A line (or table cell) that is only the name of a field, with no colon: the
// kind of label a form or table prints ("Applied Position", "O/L Maths").
export const BARE_LABEL =
  /^\s*(?:full\s+name|name|phone(?:\s+(?:no\.?|number))?|mobile(?:\s+(?:no\.?|number))?|tel(?:ephone)?|e-?mail(?:\s+address)?|address|(?:permanent|current|home|postal|mailing|residential)\s+address|o\s?\/\s?l\s+(?:maths?|mathematics)|a\s?\/\s?l\s+(?:results?|stream)|other\s+education|applied\s+position|position\s+applied(?:\s+for)?|source|application\s+source|linkedin\s+(?:link|profile|url)|nic|date\s+of\s+birth|dob)\s*[:\-–]?\s*$/i;

export const isBareLabel = (line) => BARE_LABEL.test(line);
