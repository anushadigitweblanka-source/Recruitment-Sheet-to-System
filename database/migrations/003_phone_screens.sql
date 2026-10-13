-- Migration 003: phone interviews
--
-- One table: the result of phoning a candidate. Stage changes caused by a
-- phone interview are recorded in pipeline_status and stage_history, which
-- already exist.
--
-- Not created here: direct interviews, offers, employees, notifications.

CREATE TABLE phone_screens (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  candidate_id       bigint NOT NULL REFERENCES candidates (id) ON DELETE RESTRICT,
  called             boolean NOT NULL DEFAULT false,
  -- A closed list whose values have not been approved yet, so no list is
  -- enforced here and the application does not accept a value for now.
  response           text,
  -- NULL until HR has decided.
  result             text,
  -- HR's remark about the call.
  review             text,
  -- The direct interview slot given to a selected candidate.
  interview_datetime timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  created_by         bigint REFERENCES users (id) ON DELETE RESTRICT,
  updated_by         bigint REFERENCES users (id) ON DELETE RESTRICT,
  -- The two results named in the task guide.
  CONSTRAINT phone_screens_result_valid CHECK (result IN ('selected', 'not_selected')),
  CONSTRAINT phone_screens_response_trimmed CHECK (response = btrim(response) AND response <> ''),
  CONSTRAINT phone_screens_response_length CHECK (char_length(response) <= 100),
  CONSTRAINT phone_screens_review_length CHECK (char_length(review) <= 2000),
  -- Only a selected candidate is given a direct interview slot. Written with
  -- COALESCE so that "no result yet" counts as not selected; a plain
  -- comparison with an empty result would let the row through.
  CONSTRAINT phone_screens_interview_needs_selected
    CHECK (interview_datetime IS NULL OR COALESCE(result, '') = 'selected')
);

-- Deliberately NOT unique on candidate_id: whether a candidate can have more
-- than one phone interview attempt has not been confirmed, and a unique rule
-- would rule that out. The application keeps one record per candidate for now.
CREATE INDEX phone_screens_candidate_id_idx ON phone_screens (candidate_id);
CREATE INDEX phone_screens_result_idx ON phone_screens (result);
CREATE INDEX phone_screens_interview_datetime_idx ON phone_screens (interview_datetime);
