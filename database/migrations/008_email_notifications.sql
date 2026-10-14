-- Migration 008: email notifications (Module 6)
--
-- Three tables from the schema proposal, section 12:
--   notifications    the schedule: what must be sent, to whom, and when
--   email_templates  the editable subject and body per mail type
--   email_log        every mail the system actually tried to send
--
-- The sending rule confirmed from the task guide: a job runs every 15
-- minutes and picks rows where send_at <= now AND sent_at IS NULL.
-- due_at is the deadline itself (end date at 17:30 Asia/Colombo);
-- send_at is due_at minus 24 hours. Both are stored.
--
-- Timestamps are timestamptz, so every moment is stored with its zone and
-- compared safely whatever the server's local zone is.
--
-- Not created here: salary, reporting, team_leads, company_accounts. No
-- WhatsApp/SMS channel column: mentor decision 10 put it out of scope.

-- ---------------------------------------------------------------------------
-- Email templates
-- ---------------------------------------------------------------------------

-- One editable template per mail type. Templates are edited, never deleted;
-- is_active switches one off. No template content is seeded: the wording is
-- the company's to write.
CREATE TABLE email_templates (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- A code such as 'interview_invitation'. The full list of template types
  -- is not confirmed, so the format is enforced but not a fixed list.
  type       text NOT NULL,
  -- May contain placeholders such as {name}.
  subject    text NOT NULL,
  body       text NOT NULL,
  -- 'auto' sends without review; 'review' means HR previews first. Only
  -- scheduled reminders are sent today and they follow the 15-minute rule;
  -- how send_mode applies to manual mails is decided with Module 6's
  -- manual-send features.
  send_mode  text NOT NULL DEFAULT 'review',
  is_active  boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by bigint REFERENCES users (id) ON DELETE RESTRICT,
  updated_by bigint REFERENCES users (id) ON DELETE RESTRICT,

  CONSTRAINT email_templates_type_key UNIQUE (type),
  CONSTRAINT email_templates_type_format CHECK (type ~ '^[a-z][a-z0-9_]*$'),
  CONSTRAINT email_templates_type_length CHECK (char_length(type) <= 50),
  CONSTRAINT email_templates_subject_not_blank CHECK (btrim(subject) <> ''),
  CONSTRAINT email_templates_subject_length CHECK (char_length(subject) <= 200),
  CONSTRAINT email_templates_body_not_blank CHECK (btrim(body) <> ''),
  CONSTRAINT email_templates_body_length CHECK (char_length(body) <= 10000),
  CONSTRAINT email_templates_send_mode_valid CHECK (send_mode IN ('auto', 'review'))
);

-- ---------------------------------------------------------------------------
-- Notifications (the schedule)
-- ---------------------------------------------------------------------------

CREATE TABLE notifications (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  candidate_id     bigint NOT NULL REFERENCES candidates (id) ON DELETE RESTRICT,
  -- The six reminder types named in the schema proposal (from the guide).
  type             text NOT NULL,
  -- What the reminder is about. Which column is filled follows from the
  -- type, so the same phase, interview or offer cannot collect reminders
  -- under two different subjects.
  phase_history_id bigint REFERENCES phase_history (id) ON DELETE RESTRICT,
  interview_id     bigint REFERENCES interviews (id) ON DELETE RESTRICT,
  offer_id         bigint REFERENCES offers (id) ON DELETE RESTRICT,
  -- The deadline itself (end date at 17:30 Asia/Colombo).
  due_at           timestamptz NOT NULL,
  -- due_at minus 24 hours. A send_at already in the past is simply eligible
  -- on the next run, which gives the "send immediately" behaviour.
  send_at          timestamptz NOT NULL,
  -- Empty until sent. The eligibility rule checks this column.
  sent_at          timestamptz,
  recipients       text[] NOT NULL,
  status           text NOT NULL DEFAULT 'pending',
  attempts         integer NOT NULL DEFAULT 0,
  last_error       text,
  created_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT notifications_type_valid CHECK (type IN (
    'evaluation_end', 'probation_end', 'junior_end',
    'interview_reminder', 'joining_reminder', 'cv_pending')),
  CONSTRAINT notifications_status_valid
    CHECK (status IN ('pending', 'sent', 'failed', 'cancelled')),
  -- The subject link matches the type: phase reminders point at the phase,
  -- the interview reminder at the interview, the joining reminder at the
  -- offer, and a CV chase has no row beyond the candidate.
  CONSTRAINT notifications_subject_matches_type CHECK (
    CASE type
      WHEN 'evaluation_end' THEN num_nonnulls(phase_history_id, interview_id, offer_id) = 1
                                 AND phase_history_id IS NOT NULL
      WHEN 'probation_end'  THEN num_nonnulls(phase_history_id, interview_id, offer_id) = 1
                                 AND phase_history_id IS NOT NULL
      WHEN 'junior_end'     THEN num_nonnulls(phase_history_id, interview_id, offer_id) = 1
                                 AND phase_history_id IS NOT NULL
      WHEN 'interview_reminder' THEN num_nonnulls(phase_history_id, interview_id, offer_id) = 1
                                     AND interview_id IS NOT NULL
      WHEN 'joining_reminder'   THEN num_nonnulls(phase_history_id, interview_id, offer_id) = 1
                                     AND offer_id IS NOT NULL
      WHEN 'cv_pending'         THEN num_nonnulls(phase_history_id, interview_id, offer_id) = 0
    END),
  CONSTRAINT notifications_send_before_due CHECK (send_at <= due_at),
  CONSTRAINT notifications_recipients_present CHECK (cardinality(recipients) >= 1),
  -- Sent and sent_at always agree, so the eligibility rule and the status
  -- can never contradict each other.
  CONSTRAINT notifications_sent_consistent CHECK ((status = 'sent') = (sent_at IS NOT NULL)),
  CONSTRAINT notifications_last_error_length CHECK (char_length(last_error) <= 1000)
);

-- At most one live reminder of a type per subject. A cancelled row does not
-- block the replacement that a date change creates.
CREATE UNIQUE INDEX notifications_one_per_phase ON notifications (type, phase_history_id)
  WHERE status <> 'cancelled' AND phase_history_id IS NOT NULL;
CREATE UNIQUE INDEX notifications_one_per_interview ON notifications (type, interview_id)
  WHERE status <> 'cancelled' AND interview_id IS NOT NULL;
CREATE UNIQUE INDEX notifications_one_per_offer ON notifications (type, offer_id)
  WHERE status <> 'cancelled' AND offer_id IS NOT NULL;
CREATE UNIQUE INDEX notifications_one_cv_chase ON notifications (candidate_id)
  WHERE status <> 'cancelled' AND type = 'cv_pending';

-- What the 15-minute job reads.
CREATE INDEX notifications_due_to_send ON notifications (send_at) WHERE status = 'pending';
CREATE INDEX notifications_candidate_id_idx ON notifications (candidate_id);

-- ---------------------------------------------------------------------------
-- Email log (the delivery record)
-- ---------------------------------------------------------------------------

-- Append-only apart from the status moving from queued to sent or failed.
-- Never holds passwords, tokens, mail credentials or salaries.
CREATE TABLE email_log (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- Empty for mails about no candidate (for example future report mails).
  candidate_id    bigint REFERENCES candidates (id) ON DELETE RESTRICT,
  template_id     bigint NOT NULL REFERENCES email_templates (id) ON DELETE RESTRICT,
  -- The scheduled reminder this mail came from; empty for a manual mail.
  notification_id bigint REFERENCES notifications (id) ON DELETE RESTRICT,
  to_addresses    text[] NOT NULL,
  cc_addresses    text[],
  -- What was actually sent, after placeholders were filled in.
  subject_sent    text NOT NULL,
  body_sent       text,
  status          text NOT NULL DEFAULT 'queued',
  error           text,
  -- True only for an explicit resend. The unique index below reads it.
  is_resend       boolean NOT NULL DEFAULT false,
  -- Who pressed send or resend; empty for the scheduler's automatic mails.
  sent_by         bigint REFERENCES users (id) ON DELETE RESTRICT,
  sent_at         timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT email_log_status_valid CHECK (status IN ('queued', 'sent', 'failed')),
  CONSTRAINT email_log_to_present CHECK (cardinality(to_addresses) >= 1),
  CONSTRAINT email_log_sent_has_time CHECK (status <> 'sent' OR sent_at IS NOT NULL),
  CONSTRAINT email_log_error_length CHECK (char_length(error) <= 1000),
  CONSTRAINT email_log_subject_length CHECK (char_length(subject_sent) <= 200)
);

-- "Never send the same template twice to the same candidate unless HR
-- presses Resend." A failed attempt does not block a retry; a resend is a
-- separate row with is_resend = true, so it is logged and allowed.
CREATE UNIQUE INDEX email_log_once_per_candidate ON email_log (candidate_id, template_id)
  WHERE is_resend = false AND status IN ('queued', 'sent');

CREATE INDEX email_log_candidate_id_idx ON email_log (candidate_id);
CREATE INDEX email_log_template_id_idx ON email_log (template_id);
CREATE INDEX email_log_sent_at_idx ON email_log (sent_at);
CREATE INDEX email_log_notification_id_idx ON email_log (notification_id);
