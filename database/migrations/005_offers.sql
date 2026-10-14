-- Migration 005: offers
--
-- One table: the offer made to a selected candidate, with the joining date
-- and attendance. Stage changes caused by an offer are recorded in
-- pipeline_status and stage_history, which already exist.
--
-- Not created here: salary (no column and no table, until its storage and
-- viewing rules are approved), employees, phase history, notifications,
-- email templates. Email status is not a column either: it is to be read
-- from the email log once that exists.

CREATE TABLE offers (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  candidate_id    bigint NOT NULL REFERENCES candidates (id) ON DELETE RESTRICT,
  -- The position offered, from the approved list. It may differ from the
  -- position the candidate applied for.
  position_id     bigint NOT NULL REFERENCES positions (id) ON DELETE RESTRICT,
  offer_date      date,
  -- A closed list whose values have not been approved yet, so no list is
  -- enforced here and the application does not accept a value for now.
  work_mode       text,
  location        text,
  -- NULL until the offer has been sent. Only the two values backed by the
  -- task guide's stage list ("Offer Sent", "Offer Accepted") are allowed.
  -- An approved new value is added by replacing this constraint in a new
  -- migration.
  offer_status    text,
  -- The joining date.
  onboarding_date date,
  -- NULL until the joining day; then true (attended) or false.
  attended        boolean,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  created_by      bigint REFERENCES users (id) ON DELETE RESTRICT,
  updated_by      bigint REFERENCES users (id) ON DELETE RESTRICT,

  CONSTRAINT offers_offer_status_valid CHECK (offer_status IN ('sent', 'accepted')),
  CONSTRAINT offers_work_mode_trimmed CHECK (work_mode = btrim(work_mode) AND work_mode <> ''),
  CONSTRAINT offers_work_mode_length CHECK (char_length(work_mode) <= 50),
  CONSTRAINT offers_location_trimmed CHECK (location = btrim(location) AND location <> ''),
  CONSTRAINT offers_location_length CHECK (char_length(location) <= 200),
  -- Attendance is about the joining day of an accepted offer. Written with
  -- IS NOT DISTINCT FROM so that an empty offer status is handled correctly.
  CONSTRAINT offers_attended_needs_accepted_and_date CHECK (
    attended IS NULL
    OR (onboarding_date IS NOT NULL AND offer_status IS NOT DISTINCT FROM 'accepted')
  )
);

-- Deliberately NOT unique on candidate_id: whether a candidate can receive a
-- second offer has not been confirmed. The application keeps one for now.
CREATE INDEX offers_candidate_id_idx ON offers (candidate_id);
CREATE INDEX offers_position_id_idx ON offers (position_id);
CREATE INDEX offers_offer_status_idx ON offers (offer_status);
CREATE INDEX offers_onboarding_date_idx ON offers (onboarding_date);
