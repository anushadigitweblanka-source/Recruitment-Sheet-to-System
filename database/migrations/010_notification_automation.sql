-- Migration 010: notification automation from the task guide
--
-- What changes, and why:
--
--   notifications.cc_recipients   "HR copied" on interview and joining
--                                 reminders.
--   recipients rule               A reminder that is blocked because a
--                                 required address is missing is kept as a
--                                 failed row with its reason (and may later
--                                 be cancelled), so it is visible, instead
--                                 of vanishing.
--   one live reminder             The uniqueness rules now cover pending rows
--                                 only. A date correction cancels the old
--                                 pending reminder and creates the
--                                 replacement; a reminder already sent no
--                                 longer blocks a new one for a new date.
--   send_mode                     The guide's two modes are Auto and
--                                 One-click. The earlier 'review' value
--                                 becomes 'one_click'.
--   email_log duplicate rule      "Never send the same template twice to the
--                                 same candidate unless Resend" applies to
--                                 one-off mails. A scheduled reminder is its
--                                 own event (one per phase, interview or
--                                 offer), so it is protected per
--                                 notification instead.
--   weekly_report_runs            One row per Monday-to-Sunday week, so the
--                                 weekly report can never be sent twice.
--   settings                      The editable values the automation reads.
--                                 All start empty: no address is seeded.

-- ---------------------------------------------------------------------------
-- notifications
-- ---------------------------------------------------------------------------

ALTER TABLE notifications ADD COLUMN cc_recipients text[] NOT NULL DEFAULT '{}';

ALTER TABLE notifications DROP CONSTRAINT notifications_recipients_present;
ALTER TABLE notifications ADD CONSTRAINT notifications_recipients_present
  CHECK (status IN ('failed', 'cancelled') OR cardinality(recipients) >= 1);

DROP INDEX notifications_one_per_phase;
DROP INDEX notifications_one_per_interview;
DROP INDEX notifications_one_per_offer;
DROP INDEX notifications_one_cv_chase;

CREATE UNIQUE INDEX notifications_one_per_phase ON notifications (type, phase_history_id)
  WHERE status = 'pending' AND phase_history_id IS NOT NULL;
CREATE UNIQUE INDEX notifications_one_per_interview ON notifications (type, interview_id)
  WHERE status = 'pending' AND interview_id IS NOT NULL;
CREATE UNIQUE INDEX notifications_one_per_offer ON notifications (type, offer_id)
  WHERE status = 'pending' AND offer_id IS NOT NULL;
CREATE UNIQUE INDEX notifications_one_cv_chase ON notifications (candidate_id)
  WHERE status = 'pending' AND type = 'cv_pending';

-- ---------------------------------------------------------------------------
-- email_templates: Auto or One-click
-- ---------------------------------------------------------------------------

ALTER TABLE email_templates DROP CONSTRAINT email_templates_send_mode_valid;
UPDATE email_templates SET send_mode = 'one_click' WHERE send_mode = 'review';
ALTER TABLE email_templates ALTER COLUMN send_mode SET DEFAULT 'one_click';
ALTER TABLE email_templates ADD CONSTRAINT email_templates_send_mode_valid
  CHECK (send_mode IN ('auto', 'one_click'));

-- ---------------------------------------------------------------------------
-- email_log: duplicate protection per mail event
-- ---------------------------------------------------------------------------

DROP INDEX email_log_once_per_candidate;

-- A manual mail: once per candidate and template unless it is a Resend.
CREATE UNIQUE INDEX email_log_once_per_candidate ON email_log (candidate_id, template_id)
  WHERE is_resend = false AND status IN ('queued', 'sent') AND notification_id IS NULL;

-- A scheduled mail: once per notification unless it is a Resend.
CREATE UNIQUE INDEX email_log_once_per_notification ON email_log (notification_id)
  WHERE is_resend = false AND status IN ('queued', 'sent') AND notification_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Weekly report runs
-- ---------------------------------------------------------------------------

-- One row per report week (the Monday it starts on). The unique week makes a
-- second send for the same week impossible, even from two servers.
CREATE TABLE weekly_report_runs (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  week_start date NOT NULL,
  week_end   date NOT NULL,
  status     text NOT NULL DEFAULT 'queued',
  recipients text[] NOT NULL,
  subject    text NOT NULL,
  error      text,
  attempts   integer NOT NULL DEFAULT 0,
  sent_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT weekly_report_runs_week_key UNIQUE (week_start),
  CONSTRAINT weekly_report_runs_status_valid CHECK (status IN ('queued', 'sent', 'failed')),
  CONSTRAINT weekly_report_runs_week_span CHECK (week_end = week_start + 6),
  CONSTRAINT weekly_report_runs_recipients_present CHECK (cardinality(recipients) >= 1),
  CONSTRAINT weekly_report_runs_sent_has_time CHECK (status <> 'sent' OR sent_at IS NOT NULL),
  CONSTRAINT weekly_report_runs_error_length CHECK (char_length(error) <= 1000)
);

-- ---------------------------------------------------------------------------
-- Settings the automation reads
-- ---------------------------------------------------------------------------

-- Comma-separated email addresses, edited in Settings. Empty until set.
INSERT INTO settings (key, value, description) VALUES
  ('reminder_hr_emails', '',
   'HR addresses for phase-end reminders, and copied on interview and joining reminders (comma-separated).'),
  ('reminder_manager_emails', '',
   'Mentor / manager addresses for phase-end reminders (comma-separated).'),
  ('evaluation_reminder_include_candidate', 'false',
   'true to also send the evaluation-ending reminder to the candidate (the guide: optional).'),
  ('weekly_report_recipients', '',
   'Addresses that receive the weekly report every Monday 08:00 (comma-separated). The guide names both HR plus management and the Main User, so this is left to be set.'),
  ('interview_venue', '',
   'Venue shown as {venue} in interview mails.');
