// Phase 1 of CV extraction: a CV file in, a reviewable result out.
//
// The result is a DRAFT for the Candidate Registration form. Nothing here
// creates or changes a candidate, invents a Candidate ID, or reads the
// database. Extraction is local: no CV text leaves this process.

import { validateCandidate } from '../candidates/candidates.validation.js';
import { extractCvText } from './textExtractor.js';
import { extractFields } from './fieldExtractor.js';

// The form fields extraction can fill. Names match validateCandidate().
export const EXTRACTABLE_FIELDS = [
  'fullName',
  'phone',
  'email',
  'address',
  'olMaths',
  'alResult',
  'alStream',
  'otherEducation',
];

// Fields the Candidate Registration form needs that extraction never fills.
export const NEVER_EXTRACTED = {
  candidateCode:
    'Candidate ID is typed by HR; its format is not confirmed, so it is never generated here.',
  positionId: 'Applied Position is chosen from the approved list.',
  sourceId: 'Source is chosen from the approved list.',
  cvUrl: 'The CV link is set by whoever stores the file; remote links are not fetched.',
  hrComment: 'HR Comment is written by HR.',
};

// Runs the extracted values through the same checks the candidate form uses,
// so a value the form would refuse is flagged here instead of at save time.
// The Candidate ID is a throw-away stand-in because that field is not ours.
function checkWithCandidateRules(fields) {
  const input = { candidateCode: 'PLACEHOLDER' };
  for (const name of EXTRACTABLE_FIELDS) {
    if (fields[name].value !== null) input[name] = fields[name].value;
  }
  const { values, errors } = validateCandidate(input);
  for (const name of EXTRACTABLE_FIELDS) {
    const field = fields[name];
    if (field.value === null) continue;
    if (errors[name]) {
      field.status = 'uncertain';
      field.note = [field.note, `Would be refused by the candidate form: ${errors[name]}`]
        .filter(Boolean)
        .join(' ');
    } else if (values[name] !== null && values[name] !== field.value) {
      // The form tidies this value (for example a phone number's spaces).
      field.original = field.value;
      field.value = values[name];
    }
  }
}

const failure = (reason, message) => ({
  status: 'failed',
  reason,
  message,
  source: null,
  fields: {},
  formDraft: {},
  review: { unavailable: [], uncertain: [], extracted: [] },
  notExtracted: NEVER_EXTRACTED,
  unmappedSections: [],
  warnings: [],
});

// Reads one CV. `status` is 'extracted' (every field found), 'partial'
// (some missing or uncertain) or 'failed' (the file could not be read; see
// `reason` and `message`).
export async function extractCv({ buffer }) {
  const read = await extractCvText({ buffer });
  if (!read.ok) return failure(read.reason, read.message);

  const { fields, unmappedSections, educationSectionFound } = extractFields(read.text);
  checkWithCandidateRules(fields);

  // Only values that are explicit in the CV go into the draft. Uncertain
  // values stay in `fields` for review but are not pre-filled.
  const formDraft = {};
  const review = { extracted: [], uncertain: [], unavailable: [] };
  for (const name of EXTRACTABLE_FIELDS) {
    const field = fields[name];
    review[field.status].push(name);
    if (field.status === 'extracted') formDraft[name] = field.value;
  }

  const warnings = [...read.warnings];
  if (!educationSectionFound) {
    warnings.push('No "Education" section heading was found, so education fields were not read.');
  }

  return {
    status: review.extracted.length === EXTRACTABLE_FIELDS.length ? 'extracted' : 'partial',
    reason: null,
    message: null,
    source: {
      format: read.format,
      pageCount: read.pageCount,
      characters: read.text.length,
    },
    fields,
    formDraft,
    review,
    notExtracted: NEVER_EXTRACTED,
    unmappedSections,
    warnings,
  };
}
