// The calendar invitation (.ics, RFC 5545 / iTIP) that goes with the Team Lead
// interview summary. The task guide: "Candidate summary ... and interview
// slot, with a calendar invite (.ics)".
//
// What it carries, and nothing else: candidate name and code, applied
// position, the interview time, the venue or link from Settings, and the Team
// Lead. It never carries a phone number, an email address of the candidate,
// salary, a password, or a link that grants access.
//
// Rescheduling: the UID is fixed per candidate, so a calendar shows ONE event.
// A later invitation for the same candidate carries a higher SEQUENCE and the
// new time, which calendar clients treat as an update of that event. The
// SEQUENCE is the number of earlier invitations actually sent, so an ordinary
// retry of a failed send reuses the same number.

const PRODID = '-//Recruitment Sheet to System//Interview Invitation//EN';
const TIME_ZONE = 'Asia/Colombo';
export const DEFAULT_INTERVIEW_MINUTES = 60;
export const INVITE_TEMPLATE_TYPE = 'team_lead_summary';
export const INVITE_CONTENT_TYPE = 'text/calendar; charset=UTF-8';

const pad = (n) => String(n).padStart(2, '0');

// 20261104T143000 - the wall-clock time in Asia/Colombo.
function colomboStamp(date) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: TIME_ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}${parts.month}${parts.day}T${parts.hour}${parts.minute}${parts.second}`;
}

// 20261104T090000Z - for DTSTAMP, which is always UTC.
const utcStamp = (date) =>
  `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
  `T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;

// TEXT values: control characters removed, then \ ; , and line breaks escaped.
const escapeText = (value) =>
  String(value ?? '')
    .replace(/\r\n|\r|\n/g, ' ')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,');

// A parameter value (CN) may not contain quotes, semicolons or colons.
const paramText = (value) =>
  String(value ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f"';:,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

// Content lines are limited to 75 octets; longer ones are folded with CRLF + space.
function fold(line) {
  if (Buffer.byteLength(line, 'utf8') <= 75) return line;
  const chunks = [];
  let current = '';
  let limit = 75;
  for (const char of line) {
    if (Buffer.byteLength(current + char, 'utf8') > limit) {
      chunks.push(current);
      current = char;
      limit = 74;
    } else {
      current += char;
    }
  }
  chunks.push(current);
  return chunks.join('\r\n ');
}

// eslint-disable-next-line no-control-regex
const isHttpUrl = (text) => /^https?:\/\/[^\s\u0000-\u001f\u007f]+$/i.test(text);

// Pure builder. Returns { ok: false, missing: [...] } when it cannot make a
// valid invitation, never a partial one.
export function buildInterviewInvite({
  candidateId,
  candidateCode,
  fullName,
  positionName,
  startsAt,
  venue,
  teamLeadName,
  teamLeadEmail,
  organizerEmail,
  sequence = 0,
  durationMinutes = DEFAULT_INTERVIEW_MINUTES,
  now = new Date(),
}) {
  const missing = [];
  const start = startsAt ? new Date(startsAt) : null;
  if (!start || Number.isNaN(start.getTime())) missing.push('interview date and time');
  if (!teamLeadEmail) missing.push('team lead email');
  if (!candidateId) missing.push('candidate');
  if (!fullName) missing.push('candidate name');
  if (missing.length > 0) return { ok: false, missing };

  const end = new Date(start.getTime() + durationMinutes * 60 * 1000);
  // A REQUEST needs an organizer and an attendee (iTIP). Without an HR address
  // there is no organizer, so the file is a plain iCalendar event with no METHOD.
  const method = organizerEmail ? 'REQUEST' : null;
  const place = String(venue ?? '').trim();
  const uid = `interview-${candidateId}@recruitment-sheet-to-system`;

  const description = [
    `Candidate: ${fullName}${candidateCode ? ` (${candidateCode})` : ''}`,
    positionName ? `Position: ${positionName}` : null,
    place ? `Venue or link: ${place}` : null,
    teamLeadName ? `Team Lead: ${teamLeadName}` : null,
  ].filter(Boolean);

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${PRODID}`,
    'CALSCALE:GREGORIAN',
    ...(method ? [`METHOD:${method}`] : []),
    'BEGIN:VTIMEZONE',
    `TZID:${TIME_ZONE}`,
    'BEGIN:STANDARD',
    'DTSTART:19700101T000000',
    'TZOFFSETFROM:+0530',
    'TZOFFSETTO:+0530',
    'TZNAME:+0530',
    'END:STANDARD',
    'END:VTIMEZONE',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${utcStamp(now)}`,
    `SEQUENCE:${sequence}`,
    `DTSTART;TZID=${TIME_ZONE}:${colomboStamp(start)}`,
    `DTEND;TZID=${TIME_ZONE}:${colomboStamp(end)}`,
    `SUMMARY:${escapeText(`Interview: ${fullName}${positionName ? ` - ${positionName}` : ''}`)}`,
    `DESCRIPTION:${description.map(escapeText).join('\\n')}`,
  ];
  if (place) lines.push(`LOCATION:${escapeText(place)}`);
  if (isHttpUrl(place)) lines.push(`URL:${place}`);
  if (organizerEmail) {
    lines.push(`ORGANIZER:mailto:${organizerEmail}`);
    const cn = paramText(teamLeadName);
    lines.push(
      `ATTENDEE;${cn ? `CN="${cn}";` : ''}ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:${teamLeadEmail}`,
    );
  }
  lines.push('STATUS:CONFIRMED', 'TRANSP:OPAQUE', 'END:VEVENT', 'END:VCALENDAR');

  return {
    ok: true,
    uid,
    sequence,
    method,
    startsAt: start,
    filename: 'interview.ics',
    contentType: method ? `${INVITE_CONTENT_TYPE}; method=${method}` : INVITE_CONTENT_TYPE,
    content: `${lines.map(fold).join('\r\n')}\r\n`,
  };
}

// The invitation for a candidate's Team Lead mail, from the mail context.
// `db` is the pool or a transaction client. The SEQUENCE counts the
// invitations already delivered (or waiting), never the failed attempts.
export async function inviteForTeamLeadMail(db, { context, settings, templateId, now }) {
  const { rows } = await db.query(
    `SELECT count(*)::int AS sent FROM email_log
      WHERE candidate_id = $1 AND template_id = $2 AND notification_id IS NULL
        AND status IN ('queued', 'sent')`,
    [context.candidateId, templateId],
  );
  return buildInterviewInvite({
    candidateId: context.candidateId,
    candidateCode: context.candidateCode,
    fullName: context.fullName,
    positionName: context.positionName,
    startsAt: context.interviewAt,
    venue: settings.venue,
    teamLeadName: context.teamLeadName,
    teamLeadEmail: context.teamLeadEmail,
    organizerEmail: settings.hrEmails[0],
    sequence: rows[0].sent,
    now,
  });
}

// The mail adapter's attachment shape.
export const asAttachment = (invite) => ({
  filename: invite.filename,
  contentType: invite.contentType,
  content: invite.content,
});
