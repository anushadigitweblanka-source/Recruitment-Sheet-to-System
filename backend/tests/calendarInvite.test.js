import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { buildInterviewInvite } from '../src/modules/notifications/calendarInvite.js';
import { createMailService } from '../src/modules/notifications/mailService.js';
import { sendAutomaticInterviewMails, sendMail } from '../src/modules/notifications/manualMail.js';
import { resendEmail } from '../src/modules/notifications/notifications.service.js';
import { inDays, startHarness } from './helpers/harness.js';

// The calendar invitation (.ics) that travels with the Team Lead interview
// summary. Every name, address and time is made up; the mail adapter is a spy,
// so nothing is delivered anywhere.

const HR = 'hr.sample@example.test';
const LEAD = 'lead.sample@example.test';
const VENUE = 'Sample Office, Floor 2';

// A wall-clock stamp in Asia/Colombo computed by hand (+05:30, no daylight
// saving), independent of the code under test.
const colomboStamp = (date) =>
  new Date(date.getTime() + 330 * 60 * 1000).toISOString().replace(/[-:]/g, '').slice(0, 15);

const lines = (ics) => ics.split('\r\n');
// A property of the VEVENT, with folded lines joined back together.
const field = (ics, name) => {
  const unfolded = ics.replace(/\r\n /g, '');
  return unfolded
    .slice(unfolded.indexOf('BEGIN:VEVENT'))
    .split('\r\n')
    .find((line) => line.startsWith(name));
};

let h;
let position;
let positionNoLead;
let spy;

function makeSpy() {
  const calls = [];
  return {
    mode: 'test-spy',
    calls,
    send: async (mail) => {
      calls.push(mail);
      return { delivered: true };
    },
  };
}
const brokenMail = {
  mode: 'test-broken',
  send: async () => {
    throw new Error('simulated outage');
  },
};

const send = (candidate, extra = {}, mail = spy) =>
  sendMail(
    h.db.pool,
    null,
    { candidateId: candidate.id, type: 'team_lead_summary', ...extra },
    mail,
    {
      config: h.config,
    },
  );
const logFor = (candidateId) =>
  h.query('SELECT * FROM email_log WHERE candidate_id = $1 ORDER BY id', [candidateId]);

describe('the invitation builder', () => {
  const base = {
    candidateId: 41,
    candidateCode: 'CAL-0001',
    fullName: 'Calendar Sample',
    positionName: 'Sample Position',
    startsAt: new Date('2026-11-04T09:00:00Z'), // 14:30 in Colombo
    venue: VENUE,
    teamLeadName: 'Sample Team Lead',
    teamLeadEmail: LEAD,
    organizerEmail: HR,
    now: new Date('2026-10-15T04:00:00Z'),
  };

  test('is a valid iCalendar object with CRLF lines and the Asia/Colombo time', () => {
    const invite = buildInterviewInvite(base);
    assert.equal(invite.ok, true);
    const ics = invite.content;

    assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\n'));
    assert.ok(ics.endsWith('END:VCALENDAR\r\n'));
    assert.ok(!ics.replace(/\r\n/g, '').includes('\n'), 'no bare line feeds');
    assert.ok(lines(ics).includes('VERSION:2.0'));
    assert.ok(lines(ics).includes('METHOD:REQUEST'));
    assert.ok(lines(ics).includes('TZID:Asia/Colombo'));
    assert.ok(lines(ics).includes('TZOFFSETTO:+0530'));
    assert.equal(field(ics, 'DTSTART'), 'DTSTART;TZID=Asia/Colombo:20261104T143000');
    assert.equal(field(ics, 'DTEND'), 'DTEND;TZID=Asia/Colombo:20261104T153000');
    assert.equal(field(ics, 'DTSTAMP'), 'DTSTAMP:20261015T040000Z');
    assert.equal(field(ics, 'UID'), 'UID:interview-41@recruitment-sheet-to-system');
    assert.equal(field(ics, 'SEQUENCE'), 'SEQUENCE:0');
    assert.equal(invite.contentType, 'text/calendar; charset=UTF-8; method=REQUEST');
  });

  test('converts a UTC evening that falls on the next day in Colombo', () => {
    const invite = buildInterviewInvite({ ...base, startsAt: new Date('2026-11-04T20:00:00Z') });
    assert.equal(field(invite.content, 'DTSTART'), 'DTSTART;TZID=Asia/Colombo:20261105T013000');
  });

  test('writes local midnight as 00:00, never 24:00', () => {
    const invite = buildInterviewInvite({ ...base, startsAt: new Date('2026-11-04T18:30:00Z') });
    assert.equal(field(invite.content, 'DTSTART'), 'DTSTART;TZID=Asia/Colombo:20261105T000000');
    assert.equal(field(invite.content, 'DTEND'), 'DTEND;TZID=Asia/Colombo:20261105T010000');
  });

  test('carries the candidate, position, venue and Team Lead, and the venue as LOCATION', () => {
    const { content } = buildInterviewInvite(base);
    assert.equal(field(content, 'SUMMARY'), 'SUMMARY:Interview: Calendar Sample - Sample Position');
    assert.equal(field(content, 'LOCATION'), 'LOCATION:Sample Office\\, Floor 2');
    const description = field(content, 'DESCRIPTION');
    assert.match(description, /Calendar Sample \(CAL-0001\)/);
    assert.match(description, /Position: Sample Position/);
    assert.match(description, /Team Lead: Sample Team Lead/);
    assert.match(
      field(content, 'ATTENDEE'),
      /^ATTENDEE;CN="Sample Team Lead";ROLE=REQ-PARTICIPANT.*:mailto:lead\.sample@example\.test$/,
    );
    assert.equal(field(content, 'ORGANIZER'), `ORGANIZER:mailto:${HR}`);
  });

  test('uses an online link as both LOCATION and URL', () => {
    const { content } = buildInterviewInvite({
      ...base,
      venue: 'https://meet.example.test/room-1',
    });
    assert.equal(field(content, 'URL'), 'URL:https://meet.example.test/room-1');
    assert.match(field(content, 'LOCATION'), /^LOCATION:https:\/\/meet\.example\.test\/room-1$/);
  });

  test('leaves LOCATION out when no venue is set', () => {
    const { content } = buildInterviewInvite({ ...base, venue: '' });
    assert.equal(field(content, 'LOCATION'), undefined);
    assert.doesNotMatch(content, /Venue or link/);
  });

  test('escapes text and folds long lines to 75 octets', () => {
    const { content } = buildInterviewInvite({
      ...base,
      fullName: 'Name; With, Specials\r\nINJECTED:evil',
      positionName: 'P'.repeat(120),
    });
    assert.ok(!lines(content).some((line) => line.startsWith('INJECTED')));
    for (const line of lines(content)) {
      assert.ok(Buffer.byteLength(line, 'utf8') <= 75, `line too long: ${line}`);
    }
    assert.match(content, /Name\\; With\\, Specials INJECTED:evil/);
  });

  test('is a plain event, with no METHOD, organizer or attendee, when no HR address is configured', () => {
    const { content, method, contentType } = buildInterviewInvite({
      ...base,
      organizerEmail: undefined,
    });
    assert.equal(method, null);
    assert.equal(contentType, 'text/calendar; charset=UTF-8');
    assert.ok(!lines(content).some((line) => line.startsWith('METHOD')));
    assert.equal(field(content, 'ORGANIZER'), undefined);
    assert.equal(field(content, 'ATTENDEE'), undefined);
  });

  test('refuses to build without a date, a valid date or a Team Lead address', () => {
    assert.deepEqual(buildInterviewInvite({ ...base, startsAt: null }), {
      ok: false,
      missing: ['interview date and time'],
    });
    assert.equal(buildInterviewInvite({ ...base, startsAt: 'not a date' }).ok, false);
    const noLead = buildInterviewInvite({ ...base, teamLeadEmail: '' });
    assert.deepEqual(noLead.missing, ['team lead email']);
  });
});

describe('the Team Lead summary mail', () => {
  before(async () => {
    h = await startHarness();
    spy = makeSpy();
    position = await h.lookup('positions', 'Sample Position');
    positionNoLead = await h.lookup('positions', 'Sample Position Without Lead');
    const lead = await h.api('/admin/team-leads', {
      method: 'POST',
      ...h.asAdmin,
      body: { positionId: position.id, name: 'Sample Team Lead', email: LEAD },
    });
    assert.equal(lead.status, 201);
    await h.setSetting('reminder_hr_emails', HR);
    await h.setSetting('interview_venue', VENUE);

    const created = await h.api('/email-templates', {
      method: 'POST',
      ...h.asAdmin,
      body: {
        type: 'team_lead_summary',
        subject: 'Interview slot for {name}',
        body: 'Candidate {name}, {position}. {date} {time} at {venue}.',
        sendMode: 'one_click',
      },
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
  });

  after(async () => {
    await h.stop();
  });

  async function scheduled(overrides = {}) {
    const candidate = await h.newCandidate({ positionId: position.id, ...overrides });
    const at = new Date(Math.floor(inDays(5).getTime() / 60000) * 60000);
    await h.phoneSelected(candidate, at);
    return { candidate, at };
  }

  test('carries one .ics with the scheduled interview time in Asia/Colombo', async () => {
    const { candidate, at } = await scheduled({ fullName: 'Invite Sample' });
    spy.calls.length = 0;

    const result = await send(candidate);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.data.delivered, true);

    assert.equal(spy.calls.length, 1);
    const [mail] = spy.calls;
    assert.deepEqual(mail.to, [LEAD]);
    assert.deepEqual(mail.cc, [HR]);
    assert.equal(mail.attachments.length, 1);
    const [attachment] = mail.attachments;
    assert.equal(attachment.filename, 'interview.ics');
    assert.equal(attachment.contentType, 'text/calendar; charset=UTF-8; method=REQUEST');

    const ics = attachment.content;
    assert.equal(field(ics, 'DTSTART'), `DTSTART;TZID=Asia/Colombo:${colomboStamp(at)}`);
    assert.equal(field(ics, 'UID'), `UID:interview-${candidate.id}@recruitment-sheet-to-system`);
    assert.equal(field(ics, 'SEQUENCE'), 'SEQUENCE:0');
    assert.equal(field(ics, 'LOCATION'), 'LOCATION:Sample Office\\, Floor 2');
    assert.match(field(ics, 'SUMMARY'), /Invite Sample - Sample Position/);
  });

  test('never contains candidate contact details, salary, passwords or secrets', async () => {
    const { candidate } = await scheduled();
    spy.calls.length = 0;
    await send(candidate);
    const ics = spy.calls[0].attachments[0].content;

    assert.ok(!ics.includes(candidate.email));
    assert.ok(!ics.includes(candidate.phone));
    assert.doesNotMatch(ics, /salary|password|secret|token|credential|cv/i);
    // Only the Team Lead and the HR organizer addresses appear.
    const addresses = ics
      .match(/[\w.+-]+@[\w.-]+/g)
      .filter((a) => !a.includes('recruitment-sheet'));
    assert.deepEqual([...new Set(addresses)].sort(), [HR, LEAD].sort());
  });

  test('is only generated for the Team Lead summary', async () => {
    const { candidate } = await scheduled();
    const invitation = await h.api('/email-templates', {
      method: 'POST',
      ...h.asAdmin,
      body: {
        type: 'interview_invitation',
        subject: 'Invitation {name}',
        body: 'Hello {name}.',
        sendMode: 'one_click',
      },
    });
    // A template of this type may already exist from another file's schema; the
    // schema here is fresh, so it is created once.
    assert.ok([201, 409, 422].includes(invitation.status), JSON.stringify(invitation.body));
    spy.calls.length = 0;
    const result = await sendMail(
      h.db.pool,
      null,
      { candidateId: candidate.id, type: 'interview_invitation' },
      spy,
      { config: h.config },
    );
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(spy.calls[0].attachments, undefined);
  });

  test('an ordinary retry sends no second invitation', async () => {
    const { candidate } = await scheduled();
    spy.calls.length = 0;
    assert.equal((await send(candidate)).ok, true);
    const again = await send(candidate);

    assert.equal(again.ok, false);
    assert.match(again.fields.mail, /already sent/);
    assert.equal(spy.calls.length, 1);
    assert.equal((await logFor(candidate.id)).length, 1);
  });

  test('a failed delivery is retried with the same SEQUENCE and then sent once', async () => {
    const { candidate } = await scheduled();
    const failed = await send(candidate, {}, brokenMail);
    assert.equal(failed.ok, true);
    assert.equal(failed.data.delivered, false);

    spy.calls.length = 0;
    const retry = await send(candidate);
    assert.equal(retry.ok, true, JSON.stringify(retry));
    assert.equal(spy.calls.length, 1);
    assert.equal(field(spy.calls[0].attachments[0].content, 'SEQUENCE'), 'SEQUENCE:0');

    const logs = await logFor(candidate.id);
    assert.deepEqual(
      logs.map((l) => l.status),
      ['failed', 'sent'],
    );
  });

  test('a rescheduled interview updates the same event: same UID, higher SEQUENCE, new time', async () => {
    const { candidate, at } = await scheduled();
    spy.calls.length = 0;
    await send(candidate);

    const later = new Date(at.getTime() + 26 * 3600 * 1000 + 15 * 60000);
    await h.query('UPDATE phone_screens SET interview_datetime = $1 WHERE candidate_id = $2', [
      later,
      candidate.id,
    ]);

    // Preview says it is an update, and sends nothing.
    const preview = await h.api(`/candidates/${candidate.id}/emails/preview`, {
      method: 'POST',
      ...h.asAdmin,
      body: { type: 'team_lead_summary' },
    });
    assert.equal(preview.status, 200, JSON.stringify(preview.body));
    assert.equal(preview.body.calendarInvite.sequence, 1);
    assert.equal(preview.body.calendarInvite.filename, 'interview.ics');
    assert.equal(spy.calls.length, 1);

    // Without Resend the one-mail rule still holds.
    assert.equal((await send(candidate)).ok, false);

    const resent = await send(candidate, { resend: true });
    assert.equal(resent.ok, true, JSON.stringify(resent));
    assert.equal(spy.calls.length, 2);

    const first = spy.calls[0].attachments[0].content;
    const second = spy.calls[1].attachments[0].content;
    assert.equal(field(first, 'UID'), field(second, 'UID'));
    assert.equal(field(first, 'SEQUENCE'), 'SEQUENCE:0');
    assert.equal(field(second, 'SEQUENCE'), 'SEQUENCE:1');
    assert.equal(field(second, 'DTSTART'), `DTSTART;TZID=Asia/Colombo:${colomboStamp(later)}`);
    assert.notEqual(field(first, 'DTSTART'), field(second, 'DTSTART'));
  });

  test('Resend from the email log carries a fresh invitation for the current interview time', async () => {
    const { candidate, at } = await scheduled();
    spy.calls.length = 0;
    await send(candidate);
    const [original] = await logFor(candidate.id);

    const later = new Date(at.getTime() + 2 * 24 * 3600 * 1000);
    await h.query('UPDATE phone_screens SET interview_datetime = $1 WHERE candidate_id = $2', [
      later,
      candidate.id,
    ]);

    const result = await resendEmail(h.db.pool, { id: h.admin.id }, Number(original.id), spy);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(spy.calls.length, 2);
    const ics = spy.calls[1].attachments[0].content;
    assert.equal(field(ics, 'SEQUENCE'), 'SEQUENCE:1');
    assert.equal(field(ics, 'DTSTART'), `DTSTART;TZID=Asia/Colombo:${colomboStamp(later)}`);
  });

  test('Resend from the email log is blocked when the interview time has since been removed', async () => {
    const { candidate } = await scheduled();
    spy.calls.length = 0;
    await send(candidate);
    const [original] = await logFor(candidate.id);
    await h.query('UPDATE phone_screens SET interview_datetime = NULL WHERE candidate_id = $1', [
      candidate.id,
    ]);

    const result = await resendEmail(h.db.pool, { id: h.admin.id }, Number(original.id), spy);
    assert.equal(result.ok, false);
    assert.match(result.fields.resend, /interview date and time/);
    assert.equal(spy.calls.length, 1);
    assert.equal((await logFor(candidate.id)).length, 1);
  });

  test('the automatic send, when the template is Auto, attaches the invitation too', async () => {
    const { candidate } = await scheduled();
    const templates = await h.api('/email-templates', h.asAdmin);
    const summary = templates.body.items.find((t) => t.type === 'team_lead_summary');
    const patched = await h.api(`/email-templates/${summary.id}`, {
      method: 'PATCH',
      ...h.asAdmin,
      body: { sendMode: 'auto' },
    });
    assert.equal(patched.status, 200, JSON.stringify(patched.body));
    try {
      spy.calls.length = 0;
      const results = await sendAutomaticInterviewMails(h.db.pool, {
        candidateId: candidate.id,
        mail: spy,
        config: h.config,
      });
      assert.ok(results.some((r) => r.type === 'team_lead_summary' && r.ok));
      const call = spy.calls.find((c) => c.to.includes(LEAD));
      assert.equal(call.attachments.length, 1);
      assert.match(call.attachments[0].content, /BEGIN:VEVENT/);
    } finally {
      await h.api(`/email-templates/${summary.id}`, {
        method: 'PATCH',
        ...h.asAdmin,
        body: { sendMode: 'one_click' },
      });
    }
  });

  test('is blocked, with the reason and no log row, when the interview time is missing', async () => {
    const candidate = await h.newCandidate({ positionId: position.id });
    spy.calls.length = 0;

    const result = await send(candidate);
    assert.equal(result.ok, false);
    assert.match(result.fields.mail, /interview date and time/);
    assert.equal(spy.calls.length, 0);
    assert.deepEqual(await logFor(candidate.id), []);

    const preview = await h.api(`/candidates/${candidate.id}/emails/preview`, {
      method: 'POST',
      ...h.asAdmin,
      body: { type: 'team_lead_summary' },
    });
    assert.equal(preview.body.canSend, false);
    assert.equal(preview.body.calendarInvite, null);
  });

  test('is blocked when the position has no Team Lead', async () => {
    const candidate = await h.newCandidate({ positionId: positionNoLead.id });
    await h.phoneSelected(candidate, inDays(5));
    spy.calls.length = 0;

    const result = await send(candidate);
    assert.equal(result.ok, false);
    assert.match(result.fields.mail, /team lead/);
    assert.equal(spy.calls.length, 0);
  });

  test('works with the development adapter, which delivers nothing', async () => {
    const { candidate } = await scheduled();
    const dev = createMailService();
    const result = await send(candidate, {}, dev);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.data.delivered, false);
    assert.equal(result.data.simulated, true);
    assert.equal(dev.mode, 'development');
    assert.deepEqual(
      await dev.send({ to: [LEAD], subject: 'x', attachments: [{ filename: 'a.ics' }] }),
      { delivered: false, simulated: true },
    );
    await assert.rejects(dev.send({ to: [LEAD], subject: 'x', attachments: 'nope' }));
  });
});
