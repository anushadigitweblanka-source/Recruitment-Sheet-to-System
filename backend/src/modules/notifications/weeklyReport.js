// The weekly report email from the task guide: every Monday at 08:00
// (Asia/Colombo), the report for the previous Monday-to-Sunday week.
//
// The 15-minute job calls runWeeklyReport on every tick. It does something
// only on a Monday at or after 08:00, and weekly_report_runs has one row per
// week (unique), so the report is sent once even if the job runs many times
// that day or two servers run it.
//
// The guide names two different audiences (HR plus management in one place,
// the Main User in another), so the recipients are not fixed in code: they
// are the addresses in the "weekly_report_recipients" setting. With none
// configured nothing is sent. The report holds counts only - no names,
// salaries or contact details.

import { recordAudit } from '../audit/audit.js';
import { weeklyReport } from '../reports/reports.repository.js';
import { previousWeekStart } from '../reports/reports.validation.js';
import { readSettingValues, splitEmails } from './mailContext.js';
import { isEmailAddress } from './notifications.validation.js';

const COLOMBO_PARTS = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Colombo',
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

// True on a Monday, 08:00 or later, in Asia/Colombo.
export function isWeeklyReportDue(now = new Date()) {
  const parts = Object.fromEntries(
    COLOMBO_PARTS.formatToParts(now).map((part) => [part.type, part.value]),
  );
  return parts.weekday === 'Mon' && Number(parts.hour) >= 8;
}

function composeReport(data) {
  const lines = [
    `Weekly recruitment report: ${data.weekStart} to ${data.weekEnd}`,
    '',
    `Applications received: ${data.applications}`,
    `Offers sent: ${data.offersSent}`,
    `Offers accepted: ${data.offersAccepted}`,
    `Joined: ${data.joined}`,
    `Rejected: ${data.rejected}`,
    '',
    'Stage movements:',
    ...data.movements.map((m) => `  ${m.stageName ?? m.stage}: ${m.total}`),
  ];
  return lines.join('\n');
}

export async function runWeeklyReport(pool, mail, { now = new Date() } = {}) {
  if (!isWeeklyReportDue(now)) return { status: 'not_due' };

  const settings = await readSettingValues(pool, ['weekly_report_recipients']);
  const recipients = splitEmails(settings.weekly_report_recipients);
  if (recipients.length === 0) return { status: 'no_recipients' };
  const wrong = recipients.filter((address) => !isEmailAddress(address));
  if (wrong.length > 0) return { status: 'invalid_recipients' };

  const weekStart = previousWeekStart(now);
  const data = await weeklyReport(pool, {
    weekStart,
    weekEnd: new Date(new Date(`${weekStart}T00:00:00Z`).getTime() + 6 * 86400000)
      .toISOString()
      .slice(0, 10),
  });
  const subject = `Weekly recruitment report ${data.weekStart} to ${data.weekEnd}`;

  // Claim the week: one insert wins. A failed or abandoned run may be retried.
  let claimed = await pool.query(
    `INSERT INTO weekly_report_runs (week_start, week_end, status, recipients, subject, attempts)
     VALUES ($1, $2, 'queued', $3, $4, 1)
     ON CONFLICT (week_start) DO NOTHING
     RETURNING id`,
    [data.weekStart, data.weekEnd, recipients, subject],
  );
  if (claimed.rows.length === 0) {
    claimed = await pool.query(
      `UPDATE weekly_report_runs
          SET status = 'queued', attempts = attempts + 1, recipients = $2, subject = $3, error = NULL
        WHERE week_start = $1
          AND (status = 'failed' OR (status = 'queued' AND created_at < now() - interval '30 minutes'))
        RETURNING id`,
      [data.weekStart, recipients, subject],
    );
    if (claimed.rows.length === 0) return { status: 'already_sent', weekStart: data.weekStart };
  }
  const runId = Number(claimed.rows[0].id);

  try {
    await mail.send({ to: recipients, subject, body: composeReport(data) });
  } catch (err) {
    await pool.query(
      `UPDATE weekly_report_runs SET status = 'failed', error = left($2, 1000) WHERE id = $1`,
      [runId, err.message],
    );
    await recordAudit(pool, {
      action: 'WEEKLY_REPORT_FAILED',
      entityType: 'weekly_report_runs',
      entityId: runId,
      details: { weekStart: data.weekStart, error: err.message },
    });
    return { status: 'failed', weekStart: data.weekStart };
  }

  await pool.query(`UPDATE weekly_report_runs SET status = 'sent', sent_at = now() WHERE id = $1`, [
    runId,
  ]);
  await recordAudit(pool, {
    action: 'WEEKLY_REPORT_SEND',
    entityType: 'weekly_report_runs',
    entityId: runId,
    details: { weekStart: data.weekStart, recipients: recipients.length, mode: mail.mode },
  });
  return { status: 'sent', weekStart: data.weekStart, recipients: recipients.length };
}
