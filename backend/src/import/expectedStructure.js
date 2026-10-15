// What the workbook is expected to contain, taken from
// data-maps/recruitment-workbook-to-database.md. The real workbook has not
// been seen, so exact tab names and headers are UNCONFIRMED: sheets are
// recognized by their headers, not by their names, and every header alias
// below is provisional (the guide's field meaning) until the real headers
// are confirmed. No source column is invented beyond that list.

// field: the data-map field key. aliases: provisional header spellings,
// compared lowercased. required: the row cannot be READY without it.
const area = (key, label, fields) => ({ key, label, fields });
const f = (field, aliases, { required = false, noTarget = false } = {}) => ({
  field,
  aliases,
  required,
  noTarget,
});

export const AREAS = [
  area('candidates', 'Candidates (Tab 1)', [
    f('candidateId', ['candidate id', 'candidate_id', 'id'], { required: true }),
    f('fullName', ['name', 'full name', 'candidate name'], { required: true }),
    f('phone', ['phone', 'phone number', 'contact', 'contact number']),
    f('email', ['email', 'e-mail', 'email address']),
    f('address', ['address']),
    f('olMaths', ['o/l maths', 'ol maths', 'o/l mathematics']),
    f('alResult', ['a/l result', 'al result']),
    f('alStream', ['a/l stream', 'al stream', 'stream']),
    f('otherEducation', ['other education', 'other qualifications']),
    f('position', ['applied position', 'position', 'position applied'], { required: true }),
    f('cvUrl', ['cv link', 'cv url', 'cv']),
    f('companyCvUrl', ['company cv link', 'company cv']),
    f('companyCvStatus', ['company cv status']),
    f('source', ['source']),
    f('hrComment', ['hr comment', 'comment', 'remarks']),
  ]),
  area('phone_screens', 'Phone interview (Tab 2)', [
    f('candidateId', ['candidate id', 'candidate_id', 'id']),
    f('called', ['called'], { required: true }),
    f('response', ['response']),
    f('result', ['result']),
    f('review', ['review']),
    f('interviewDatetime', ['direct interview date', 'interview date', 'interview date/time']),
  ]),
  area('interviews', 'Direct interview (Tab 3 / Tab 7)', [
    f('candidateId', ['candidate id', 'candidate_id', 'id']),
    f('scheduledAt', ['interview date', 'interview date/time', 'date'], { required: true }),
    f('attendance', ['attendance', 'attended']),
    f('interviewer', ['interviewer', 'interviewer name']),
    f('scoreTechnical', ['technical'], { required: true }),
    f('scoreAi', ['ai'], { required: true }),
    f('scoreCommunication', ['communication'], { required: true }),
    f('scoreConfidence', ['confidence'], { required: true }),
    f('scoreCultureFit', ['culture fit', 'culture'], { required: true }),
    f('totalSource', ['total', 'total score']),
    f('recommendation', ['recommendation']),
    f('decision', ['decision', 'status']),
    f('remarks', ['remarks']),
  ]),
  // The older interview log (guide section 10): name, phone, position,
  // status and remarks with NO candidate ID, so rows are matched to the master
  // by phone and then by name. "noTarget" marks a column the system has no
  // place for yet; it is reported, never imported.
  area('interview_schedules', 'Interview schedules (Tab 7)', [
    f('fullName', ['name', 'candidate name', 'full name'], { required: true }),
    f('phone', ['contact #', 'contact no', 'contact', 'contact number', 'phone', 'phone number']),
    f('scheduledText', ['date', 'interview date', 'date/time']),
    f('source', ['source']),
    f('position', ['position', 'applied position']),
    f('mode', ['mode', 'interview mode'], { noTarget: true }),
    f('status', ['status']),
    f('remarks', ['remarks', 'remark']),
  ]),
  area('offers', 'Offer (Tab 4)', [
    f('candidateId', ['candidate id', 'candidate_id', 'id'], { required: true }),
    f('position', ['position', 'offered position']),
    f('offerDate', ['offer date'], { required: true }),
    f('workMode', ['work mode']),
    f('location', ['location']),
    f('offerStatus', ['offer status', 'status']),
    f('onboardingDate', ['onboarding date', 'joining date']),
    f('attended', ['attended', 'attendance']),
  ]),
  area('employees', 'Employee lifecycle (Tab 8)', [
    f('candidateId', ['candidate id', 'candidate_id', 'id'], { required: true }),
    f('joinDate', ['join date', 'joining date'], { required: true }),
    f('track', ['track']),
    f('currentPhase', ['current phase', 'phase']),
    f('phaseStart', ['phase start', 'phase start date']),
    f('phaseEnd', ['phase end', 'phase end date']),
    f('status', ['status', 'outcome']),
  ]),
];

// Headers that must never be imported, whatever sheet they appear on.
export const FORBIDDEN_HEADERS = [
  { match: /salary|remuneration|pay\b|wage/i, code: 'salary_column_present' },
];

// Recognizes which area a sheet holds by counting header matches. A sheet
// needs at least `MIN_MATCHES` known headers; otherwise it is unknown and
// every row of it goes to review, never silently imported.
const MIN_MATCHES = 3;

export function detectArea(headers) {
  const lower = headers.map((h) => h.toLowerCase());
  let best = null;
  for (const candidate of AREAS) {
    const matched = candidate.fields.filter((fld) =>
      fld.aliases.some((alias) => lower.includes(alias)),
    );
    if (matched.length >= MIN_MATCHES && (!best || matched.length > best.matched.length)) {
      best = { area: candidate, matched };
    }
  }
  return best; // null => unknown sheet
}

// Maps each known field to the actual header found, and lists headers the
// data map does not know (sent to review, not refused).
export function mapHeaders(areaDef, headers) {
  const lower = headers.map((h) => h.toLowerCase());
  const fieldToHeader = {};
  const matchedHeaders = new Set();

  for (const fld of areaDef.fields) {
    for (const alias of fld.aliases) {
      const idx = lower.indexOf(alias);
      if (idx !== -1) {
        fieldToHeader[fld.field] = headers[idx];
        matchedHeaders.add(headers[idx]);
        break;
      }
    }
  }

  const unknownHeaders = headers.filter((h) => !matchedHeaders.has(h));
  const missingRequired = areaDef.fields
    .filter((fld) => fld.required && !fieldToHeader[fld.field])
    .map((fld) => fld.field);

  return { fieldToHeader, unknownHeaders, missingRequired };
}
