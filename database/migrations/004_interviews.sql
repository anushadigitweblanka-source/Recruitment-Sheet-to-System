-- Migration 004: direct interviews
--
-- One table: a scored direct interview. Stage changes caused by an interview
-- are recorded in pipeline_status and stage_history, which already exist.
--
-- Not created here: offers, salary, employees, notifications.

CREATE TABLE interviews (
  id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  candidate_id        bigint NOT NULL REFERENCES candidates (id) ON DELETE RESTRICT,
  scheduled_at        timestamptz NOT NULL,
  -- NULL until the interview time has passed and attendance is known.
  attendance          text,
  -- Plain text, as in the workbook. Interviewers do not have logins yet.
  interviewer_name    text,
  -- The five scores named in the task guide, each from 0 to 10.
  score_technical     smallint,
  score_ai            smallint,
  score_communication smallint,
  score_confidence    smallint,
  score_culture_fit   smallint,
  -- Out of 50. Worked out by the database from the five scores, so it can
  -- never be typed, imported wrongly or drift from them. Empty until all
  -- five scores are present.
  total_score         smallint GENERATED ALWAYS AS (
    score_technical + score_ai + score_communication + score_confidence + score_culture_fit
  ) STORED,
  -- A closed list whose values have not been approved yet, so no list is
  -- enforced here and the application does not accept a value for now.
  recommendation      text,
  -- The guide's "status": NULL until decided.
  decision            text,
  remarks             text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  created_by          bigint REFERENCES users (id) ON DELETE RESTRICT,
  updated_by          bigint REFERENCES users (id) ON DELETE RESTRICT,

  CONSTRAINT interviews_attendance_valid CHECK (attendance IN ('attended', 'not_attended')),
  CONSTRAINT interviews_score_technical_range CHECK (score_technical BETWEEN 0 AND 10),
  CONSTRAINT interviews_score_ai_range CHECK (score_ai BETWEEN 0 AND 10),
  CONSTRAINT interviews_score_communication_range CHECK (score_communication BETWEEN 0 AND 10),
  CONSTRAINT interviews_score_confidence_range CHECK (score_confidence BETWEEN 0 AND 10),
  CONSTRAINT interviews_score_culture_fit_range CHECK (score_culture_fit BETWEEN 0 AND 10),
  -- All five scores or none: a half-scored interview would have no total and
  -- could be mistaken for a finished one.
  CONSTRAINT interviews_scores_all_or_none CHECK (
    num_nulls(score_technical, score_ai, score_communication, score_confidence, score_culture_fit) IN (0, 5)
  ),
  -- The three decisions named in the task guide.
  CONSTRAINT interviews_decision_valid CHECK (decision IN ('selected', 'not_selected', 'on_hold')),
  -- A candidate who did not attend cannot have scores or a decision. Written
  -- with IS DISTINCT FROM so that an empty attendance is handled correctly.
  CONSTRAINT interviews_absent_has_no_result CHECK (
    attendance IS DISTINCT FROM 'not_attended'
    OR (
      decision IS NULL
      AND num_nulls(score_technical, score_ai, score_communication, score_confidence, score_culture_fit) = 5
    )
  ),
  CONSTRAINT interviews_interviewer_name_trimmed
    CHECK (interviewer_name = btrim(interviewer_name) AND interviewer_name <> ''),
  CONSTRAINT interviews_interviewer_name_length CHECK (char_length(interviewer_name) <= 150),
  CONSTRAINT interviews_recommendation_trimmed
    CHECK (recommendation = btrim(recommendation) AND recommendation <> ''),
  CONSTRAINT interviews_recommendation_length CHECK (char_length(recommendation) <= 100),
  CONSTRAINT interviews_remarks_length CHECK (char_length(remarks) <= 2000)
);

-- Deliberately NOT unique on candidate_id: a candidate may be interviewed
-- again (for example after a no-show), and whether that is a new record has
-- not been confirmed. The application keeps one record per candidate for now.
CREATE INDEX interviews_candidate_id_idx ON interviews (candidate_id);
CREATE INDEX interviews_scheduled_at_idx ON interviews (scheduled_at);
CREATE INDEX interviews_decision_idx ON interviews (decision);
