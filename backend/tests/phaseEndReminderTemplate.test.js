import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  COMPANY_CV_PLACEHOLDERS,
  PLACEHOLDERS,
  TEMPLATE_TYPES,
  formatDate,
  renderTemplate,
  templateTypeFor,
} from '../src/modules/notifications/emailTypes.js';
import { validateTemplate } from '../src/modules/notifications/notifications.validation.js';

// PROPOSED wording for the phase_end_reminder mail. It is NOT approved by the
// company and NOT stored in any database: this test only checks that the text
// is valid and renders correctly with made-up data. See
// documentation/phase-end-reminder-template.md.
const PROPOSED = {
  type: 'phase_end_reminder',
  subject: 'Reminder: {name} - phase ends tomorrow ({date})',
  body: [
    'Hello,',
    '',
    'This is a reminder that the current phase for {name} ({position}) ends tomorrow, {date}, at 17:30 (office closing, Asia/Colombo).',
    '',
    'Please review it and record the decision (Pass, Extend or Discontinue, as the phase allows) in the Recruitment System before the phase ends.',
    '',
    'Regards,',
    'Recruitment System',
  ].join('\n'),
  sendMode: 'auto',
  isActive: true,
};

describe('proposed phase_end_reminder template (fictional data only)', () => {
  test('it is the supported type, shared by evaluation, probation and junior reminders', () => {
    assert.ok(TEMPLATE_TYPES.phase_end_reminder);
    for (const type of ['evaluation_end', 'probation_end', 'junior_end']) {
      assert.equal(templateTypeFor(type), 'phase_end_reminder');
    }
  });

  test('it passes the server template validation with the Auto send mode', () => {
    const { errors, values } = validateTemplate(PROPOSED);
    assert.deepEqual(errors, {});
    assert.equal(values.type, 'phase_end_reminder');
  });

  test('it uses only supported placeholders', () => {
    const allowed = new Set([...PLACEHOLDERS, ...COMPANY_CV_PLACEHOLDERS]);
    const used = `${PROPOSED.subject}\n${PROPOSED.body}`.match(/\{[a-z_]+\}/g) ?? [];
    assert.ok(used.length > 0);
    for (const placeholder of used) {
      assert.ok(allowed.has(placeholder.slice(1, -1)), `${placeholder} is not supported`);
    }
  });

  test('it renders the phase end date and leaves no placeholder behind', () => {
    // A phase reminder is due at 17:30 Colombo on the end date (12:00 UTC).
    const values = {
      name: 'Sample Person',
      position: 'Sample Position',
      date: formatDate('2026-11-08T12:00:00.000Z'),
      time: '',
    };
    const subject = renderTemplate(PROPOSED.subject, values);
    const body = renderTemplate(PROPOSED.body, values);

    assert.equal(subject, 'Reminder: Sample Person - phase ends tomorrow (08 Nov 2026)');
    assert.match(body, /Sample Person \(Sample Position\) ends tomorrow, 08 Nov 2026, at 17:30/);
    assert.doesNotMatch(`${subject}${body}`, /\{[a-z_]+\}/);
    assert.ok(subject.length <= 200);
  });
});
