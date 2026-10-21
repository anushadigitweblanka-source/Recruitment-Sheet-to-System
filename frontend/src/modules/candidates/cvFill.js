// How details read from a CV reach the Add Candidate form.
//
// The rules:
//   - A reliable value goes straight into its field.
//   - A field HR has typed in, or changed after it was filled, is never
//     overwritten by a later CV; only fields that are empty, or still hold what
//     an earlier CV put there, are updated.
//   - Anything the CV does not state stays empty. Nothing is guessed.
//   - Applied Position and Source are chosen only when the CV states a name
//     that equals an existing, active option.

// The form fields a CV can fill.
const AUTO_FIELDS = [
  'fullName',
  'phone',
  'phone2',
  'email',
  'linkedinUrl',
  'address',
  'olMaths',
  'alResult',
  'alStream',
  'otherEducation',
  'positionId',
  'sourceId',
  'cvUrl',
];

const normalise = (text) =>
  String(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

// The id (as the form holds it) of the single active option whose name equals
// the text, ignoring case, spacing and punctuation. Otherwise null.
export function matchLookup(items, text) {
  const key = text ? normalise(text) : '';
  if (!key) return null;
  const hits = (items ?? []).filter((item) => item.isActive && normalise(item.name) === key);
  return hits.length === 1 ? String(hits[0].id) : null;
}

// Puts `found` into `values`. `autoFilled` is what earlier CVs put in, so a
// field changed since then is recognised as HR's own. With clearStale, a field
// an earlier CV filled that this one does not state is emptied again.
export function fillFields({ values, autoFilled, found, clearStale }) {
  const next = { ...values };
  const nextAutoFilled = {};
  for (const name of AUTO_FIELDS) {
    const current = values[name] ?? '';
    const stillAutomatic = current === (autoFilled[name] ?? null) && current !== '';
    if (current.trim() !== '' && !stillAutomatic) continue; // HR's own value

    if (name in found) {
      next[name] = found[name];
      nextAutoFilled[name] = found[name];
    } else if (stillAutomatic && clearStale) {
      next[name] = '';
    } else if (stillAutomatic) {
      nextAutoFilled[name] = current;
    }
  }
  return { values: next, autoFilled: nextAutoFilled };
}

// Everything one extraction answer can fill in.
export function applyExtraction({ values, autoFilled, body, lookups }) {
  const { extraction, cvUrl } = body;
  const found = { ...extraction.formDraft };
  // A stated applied position is used; only when the CV states none is the role
  // it aims at (headline, objective, target role) used instead. Either way it
  // is selected only if it equals an existing, active option.
  const applied = extraction.hints?.appliedPosition;
  const position = applied
    ? matchLookup(lookups.positions, applied)
    : matchLookup(lookups.positions, extraction.hints?.targetPosition);
  const source = matchLookup(lookups.sources, extraction.hints?.source);
  if (position) found.positionId = position;
  if (source) found.sourceId = source;
  if (cvUrl) found.cvUrl = cvUrl;
  return fillFields({ values, autoFilled, found, clearStale: true });
}

// What to tell HR about the Applied Position, or null for nothing: the text the
// CV gives when it matches no existing option ("Suggested from CV: ..."). A
// position that matched is simply selected, so it needs no message.
//   kind 'applied': the CV states the position it applies for
//   kind 'target':  the CV only shows the role it aims at (headline or objective)
export function positionSuggestion(extraction, lookups) {
  const applied = extraction.hints?.appliedPosition;
  const target = extraction.hints?.targetPosition;
  const [text, kind] = applied ? [applied, 'applied'] : [target, 'target'];
  if (!text || matchLookup(lookups.positions, text)) return null;
  return { kind, text };
}

// Short messages shown under a field, only where the CV was genuinely
// ambiguous (for example two equally likely phone numbers or two names).
export function reviewNotes(extraction) {
  const notes = {};
  for (const name of extraction.review.uncertain) {
    if (extraction.fields[name]?.note) notes[name] = extraction.fields[name].note;
  }
  // A field that was filled although the CV offered more than one value
  // (several emails or phone numbers) says so, so HR can change it.
  for (const name of ['phone', 'email']) {
    const field = extraction.fields[name];
    if (field?.status === 'extracted' && field.alternatives?.length && field.note) {
      notes[name] = field.note;
    }
  }
  return notes;
}
