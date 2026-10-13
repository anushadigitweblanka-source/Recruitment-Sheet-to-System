-- Migration 002: candidate management
--
-- Lookup lists (positions, sources, pipeline_stages), the candidates
-- themselves, where each candidate is in the pipeline (pipeline_status) and
-- every stage change (stage_history).
--
-- Not created here: phone screens, interviews, offers, employees, uploaded
-- files. Those wait for their own modules and decisions.

-- ---------------------------------------------------------------------------
-- Lookup lists
-- ---------------------------------------------------------------------------

-- Applied positions and candidate sources. Both start empty: the approved
-- values are added by an administrator, never invented here.
CREATE TABLE positions (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name       text NOT NULL,
  is_active  boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by bigint REFERENCES users (id) ON DELETE RESTRICT,
  updated_by bigint REFERENCES users (id) ON DELETE RESTRICT,
  CONSTRAINT positions_name_trimmed CHECK (name = btrim(name) AND name <> ''),
  CONSTRAINT positions_name_length CHECK (char_length(name) <= 100)
);

-- "Intern - Automation" and "intern - automation" are the same position.
CREATE UNIQUE INDEX positions_name_key ON positions (lower(name));

CREATE TABLE sources (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name       text NOT NULL,
  is_active  boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by bigint REFERENCES users (id) ON DELETE RESTRICT,
  updated_by bigint REFERENCES users (id) ON DELETE RESTRICT,
  CONSTRAINT sources_name_trimmed CHECK (name = btrim(name) AND name <> ''),
  CONSTRAINT sources_name_length CHECK (char_length(name) <= 100)
);

CREATE UNIQUE INDEX sources_name_key ON sources (lower(name));

-- The stages a candidate can be in before joining. Kept as rows rather than a
-- fixed constraint, so an approved new stage is added with one INSERT.
CREATE TABLE pipeline_stages (
  code       text PRIMARY KEY,
  name       text NOT NULL,
  sort_order integer NOT NULL,
  CONSTRAINT pipeline_stages_code_format CHECK (code ~ '^[a-z][a-z0-9_]*$'),
  CONSTRAINT pipeline_stages_name_key UNIQUE (name),
  CONSTRAINT pipeline_stages_sort_order_key UNIQUE (sort_order)
);

-- The twelve pre-joining stages listed in the task guide, in its order.
INSERT INTO pipeline_stages (code, name, sort_order) VALUES
  ('applied',             'Applied',             10),
  ('phone_screened',      'Phone Screened',      20),
  ('interview_scheduled', 'Interview Scheduled', 30),
  ('interviewed',         'Interviewed',         40),
  ('selected',            'Selected',            50),
  ('offer_sent',          'Offer Sent',          60),
  ('offer_accepted',      'Offer Accepted',      70),
  ('joined',              'Joined',              80),
  ('on_hold',             'On Hold',             90),
  ('rejected',            'Rejected',            100),
  ('not_attended',        'Not Attended',        110),
  ('no_response',         'No Response',         120);

-- ---------------------------------------------------------------------------
-- Candidates
-- ---------------------------------------------------------------------------

CREATE TABLE candidates (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- The Candidate ID people see and search by. Its format is not fixed here.
  candidate_code    text NOT NULL,
  full_name         text NOT NULL,
  -- Text, never a number, so a leading 0 is kept.
  phone             text,
  email             text,
  address           text,
  ol_maths          text,
  al_result         text,
  al_stream         text,
  other_education   text,
  position_id       bigint REFERENCES positions (id) ON DELETE RESTRICT,
  source_id         bigint REFERENCES sources (id) ON DELETE RESTRICT,
  cv_url            text,
  company_cv_url    text,
  company_cv_status text NOT NULL DEFAULT 'not_sent',
  hr_comment        text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  created_by        bigint REFERENCES users (id) ON DELETE RESTRICT,
  updated_by        bigint REFERENCES users (id) ON DELETE RESTRICT,
  CONSTRAINT candidates_code_trimmed CHECK (candidate_code = btrim(candidate_code) AND candidate_code <> ''),
  CONSTRAINT candidates_code_single_line CHECK (candidate_code !~ '[\r\n\t]'),
  CONSTRAINT candidates_code_length CHECK (char_length(candidate_code) <= 30),
  CONSTRAINT candidates_full_name_trimmed CHECK (full_name = btrim(full_name) AND full_name <> ''),
  CONSTRAINT candidates_full_name_length CHECK (char_length(full_name) <= 150),
  -- An optional "+", then 9 to 15 digits. No spaces, so numbers compare reliably.
  CONSTRAINT candidates_phone_format CHECK (phone ~ '^\+?[0-9]{9,15}$'),
  CONSTRAINT candidates_email_normalized CHECK (email = lower(btrim(email))),
  CONSTRAINT candidates_email_format CHECK (email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  CONSTRAINT candidates_cv_url_format CHECK (cv_url ~ '^https?://[^[:space:]]+$'),
  CONSTRAINT candidates_company_cv_url_format CHECK (company_cv_url ~ '^https?://[^[:space:]]+$'),
  CONSTRAINT candidates_company_cv_status_valid
    CHECK (company_cv_status IN ('not_sent', 'sent', 'received', 'overdue'))
);

-- The only hard uniqueness rule: no two candidates share a Candidate ID,
-- whatever the letter case.
CREATE UNIQUE INDEX candidates_candidate_code_key ON candidates (lower(candidate_code));

-- Phone and email are deliberately NOT unique: family members share numbers,
-- and a person may apply twice. They are indexed so likely duplicates can be
-- found quickly and shown as a warning.
CREATE INDEX candidates_phone_match_idx
  ON candidates (right(regexp_replace(phone, '\D', '', 'g'), 9))
  WHERE phone IS NOT NULL;
CREATE INDEX candidates_email_idx ON candidates (email) WHERE email IS NOT NULL;
CREATE INDEX candidates_full_name_idx ON candidates (lower(full_name));
CREATE INDEX candidates_position_id_idx ON candidates (position_id);
CREATE INDEX candidates_source_id_idx ON candidates (source_id);
CREATE INDEX candidates_created_at_idx ON candidates (created_at);

-- ---------------------------------------------------------------------------
-- Pipeline: where each candidate is now, and every change along the way
-- ---------------------------------------------------------------------------

-- One row per candidate.
CREATE TABLE pipeline_status (
  candidate_id       bigint PRIMARY KEY REFERENCES candidates (id) ON DELETE RESTRICT,
  current_stage      text NOT NULL DEFAULT 'applied' REFERENCES pipeline_stages (code) ON DELETE RESTRICT,
  hold_reason        text,
  reject_reason      text,
  next_followup_date date,
  responsible_hr_id  bigint REFERENCES users (id) ON DELETE RESTRICT,
  stage_changed_at   timestamptz NOT NULL DEFAULT now(),
  updated_by         bigint REFERENCES users (id) ON DELETE RESTRICT,
  CONSTRAINT pipeline_status_hold_reason_required
    CHECK (current_stage <> 'on_hold' OR btrim(coalesce(hold_reason, '')) <> ''),
  CONSTRAINT pipeline_status_reject_reason_required
    CHECK (current_stage <> 'rejected' OR btrim(coalesce(reject_reason, '')) <> '')
);

CREATE INDEX pipeline_status_current_stage_idx ON pipeline_status (current_stage);
CREATE INDEX pipeline_status_next_followup_date_idx ON pipeline_status (next_followup_date);
CREATE INDEX pipeline_status_responsible_hr_id_idx ON pipeline_status (responsible_hr_id);

-- Append-only: one row for every stage a candidate enters, so no earlier
-- state is ever lost.
CREATE TABLE stage_history (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  candidate_id bigint NOT NULL REFERENCES candidates (id) ON DELETE RESTRICT,
  from_stage   text REFERENCES pipeline_stages (code) ON DELETE RESTRICT, -- NULL for the first row
  to_stage     text NOT NULL REFERENCES pipeline_stages (code) ON DELETE RESTRICT,
  reason       text,
  changed_by   bigint REFERENCES users (id) ON DELETE RESTRICT, -- NULL = system
  changed_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX stage_history_candidate_idx ON stage_history (candidate_id, changed_at);
