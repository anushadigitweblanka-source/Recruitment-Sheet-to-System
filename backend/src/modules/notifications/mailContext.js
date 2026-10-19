// Gathers what a mail about one candidate needs: the candidate, the Team Lead
// chosen from the applied position, the interview slot, the joining date.
// `db` is the pool or a transaction client. Nothing here reads salary or any
// credential; the context is built only from the columns listed below.

import { formatDate, formatTime } from './emailTypes.js';

export const splitEmails = (text) =>
  String(text ?? '')
    .split(/[,;\s]+/)
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);

export async function readSettingValues(db, keys) {
  const { rows } = await db.query('SELECT key, value FROM settings WHERE key = ANY($1)', [keys]);
  return Object.fromEntries(rows.map((row) => [row.key, row.value]));
}

// The mail addresses configured in Settings, as arrays.
export async function readMailSettings(db) {
  const values = await readSettingValues(db, [
    'reminder_hr_emails',
    'reminder_manager_emails',
    'evaluation_reminder_include_candidate',
    'interview_venue',
    'company_cv_template_url',
  ]);
  return {
    hrEmails: splitEmails(values.reminder_hr_emails),
    managerEmails: splitEmails(values.reminder_manager_emails),
    includeCandidateOnEvaluation: values.evaluation_reminder_include_candidate === 'true',
    venue: (values.interview_venue ?? '').trim(),
    companyCvTemplateUrl: (values.company_cv_template_url ?? '').trim(),
  };
}

export async function loadMailContext(db, candidateId) {
  const { rows } = await db.query(
    `SELECT c.id, c.candidate_code, c.full_name, c.email, c.phone, c.position_id,
            c.company_cv_status, c.company_cv_url,
            p.name AS position_name,
            tl.name AS team_lead_name, tl.email AS team_lead_email,
            ps.current_stage,
            (SELECT x.scheduled_at FROM interviews x
              WHERE x.candidate_id = c.id ORDER BY x.id DESC LIMIT 1) AS interview_at,
            (SELECT x.interview_datetime FROM phone_screens x
              WHERE x.candidate_id = c.id AND x.interview_datetime IS NOT NULL
              ORDER BY x.id DESC LIMIT 1) AS planned_at,
            (SELECT to_char(o.onboarding_date, 'YYYY-MM-DD') FROM offers o
              WHERE o.candidate_id = c.id ORDER BY o.id DESC LIMIT 1) AS onboarding_date,
            (SELECT o.location FROM offers o
              WHERE o.candidate_id = c.id ORDER BY o.id DESC LIMIT 1) AS offer_location
       FROM candidates c
       JOIN pipeline_status ps ON ps.candidate_id = c.id
       LEFT JOIN positions p ON p.id = c.position_id
       LEFT JOIN team_leads tl ON tl.position_id = c.position_id AND tl.is_active
      WHERE c.id = $1`,
    [candidateId],
  );
  const row = rows[0];
  if (!row) return null;

  return {
    candidateId: Number(row.id),
    candidateCode: row.candidate_code,
    fullName: row.full_name,
    email: row.email,
    phone: row.phone,
    positionName: row.position_name,
    teamLeadName: row.team_lead_name,
    teamLeadEmail: row.team_lead_email,
    stage: row.current_stage,
    // The interview time: the recorded interview when there is one, else the
    // slot agreed in the phone interview.
    interviewAt: row.interview_at ?? row.planned_at,
    onboardingDate: row.onboarding_date,
    offerLocation: row.offer_location,
    companyCvStatus: row.company_cv_status,
    companyCvUrl: row.company_cv_url,
  };
}

// The values behind the guide's placeholders. `kind` decides which date the
// {date} and {time} placeholders show.
export function placeholderValues(context, settings, { kind = 'interview', extra = {} } = {}) {
  const onJoining = kind === 'joining';
  return {
    name: context.fullName,
    position: context.positionName ?? '',
    date: onJoining ? formatDate(context.onboardingDate) : formatDate(context.interviewAt),
    time: onJoining ? '' : formatTime(context.interviewAt),
    venue: onJoining ? (context.offerLocation ?? settings.venue) : settings.venue,
    team_lead: context.teamLeadName ?? '',
    candidate_code: context.candidateCode,
    ...extra,
  };
}
