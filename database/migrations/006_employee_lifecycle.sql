-- Migration 006: employee lifecycle
--
-- Who has joined (employees), every phase they have been in with its gate
-- decision (phase_history), and the phase lengths as editable values
-- (settings), because the task guide says to keep the durations "as editable
-- settings, not hard-coded".
--
-- Not created here: notifications, email templates, email log, salary,
-- company accounts.

-- ---------------------------------------------------------------------------
-- Settings
-- ---------------------------------------------------------------------------

CREATE TABLE settings (
  key         text PRIMARY KEY,
  value       text NOT NULL,
  description text,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  bigint REFERENCES users (id) ON DELETE RESTRICT,
  CONSTRAINT settings_key_format CHECK (key ~ '^[a-z][a-z0-9_]*$')
);

-- The durations from the task guide, section 3.
INSERT INTO settings (key, value, description) VALUES
  ('evaluation_days', '7',
   'Length of the evaluation, in days. Day 1 is the join date.'),
  ('probation_months', '3',
   'Length of probation, in months.'),
  ('probation_max_extension_months', '1',
   'The most probation can be extended by, in months.'),
  ('junior_months', '9',
   'Length of the junior phase, in months. Not used for any calculation yet: whether it counts from the end of probation or from the join date is not confirmed.');

-- ---------------------------------------------------------------------------
-- Employees
-- ---------------------------------------------------------------------------

-- One row per candidate who has joined.
CREATE TABLE employees (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  candidate_id     bigint NOT NULL REFERENCES candidates (id) ON DELETE RESTRICT,
  -- The onboarding date of the offer the candidate attended. Day 1.
  join_date        date NOT NULL,
  -- Intern or Staff, from the task guide. Empty until HR sets it: the guide
  -- does not say where it comes from.
  track            text,
  -- These three repeat the employee's latest phase_history row, as the guide
  -- asks, and are updated in the same transaction as that row.
  current_phase    text NOT NULL DEFAULT 'evaluation',
  phase_start      date NOT NULL,
  -- Empty for the senior phase, and for a junior phase whose end date has
  -- not been entered.
  phase_end        date,
  -- The guide's "outcome". Active employees are shown as Currently Working.
  status           text NOT NULL DEFAULT 'active',
  exit_date        date,
  exit_reason      text,
  -- Who recorded a termination; the terminated report shows "approved by".
  exit_approved_by bigint REFERENCES users (id) ON DELETE RESTRICT,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by       bigint REFERENCES users (id) ON DELETE RESTRICT,
  updated_by       bigint REFERENCES users (id) ON DELETE RESTRICT,

  -- A candidate becomes an employee once.
  CONSTRAINT employees_candidate_id_key UNIQUE (candidate_id),
  CONSTRAINT employees_track_valid CHECK (track IN ('intern', 'staff')),
  CONSTRAINT employees_current_phase_valid
    CHECK (current_phase IN ('evaluation', 'probation', 'junior', 'senior')),
  CONSTRAINT employees_status_valid CHECK (status IN ('active', 'discontinued', 'terminated')),
  CONSTRAINT employees_phase_after_join CHECK (phase_start >= join_date),
  CONSTRAINT employees_phase_end_after_start CHECK (phase_end IS NULL OR phase_end >= phase_start),
  -- Leaving needs a date and a reason; an active employee has neither.
  CONSTRAINT employees_exit_details CHECK (
    (status = 'active' AND exit_date IS NULL AND exit_reason IS NULL AND exit_approved_by IS NULL)
    OR (status <> 'active' AND exit_date IS NOT NULL AND btrim(coalesce(exit_reason, '')) <> '')
  ),
  CONSTRAINT employees_exit_after_join CHECK (exit_date IS NULL OR exit_date >= join_date),
  CONSTRAINT employees_exit_reason_length CHECK (char_length(exit_reason) <= 1000)
);

CREATE INDEX employees_status_idx ON employees (status);
CREATE INDEX employees_current_phase_idx ON employees (current_phase);
CREATE INDEX employees_phase_end_idx ON employees (phase_end);

-- ---------------------------------------------------------------------------
-- Phase history
-- ---------------------------------------------------------------------------

-- One row per phase an employee has been in, plus one row per probation
-- extension. Never overwritten: a gate decision fills in the result of the
-- open row, and the next phase is a new row.
CREATE TABLE phase_history (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  employee_id    bigint NOT NULL REFERENCES employees (id) ON DELETE RESTRICT,
  phase          text NOT NULL,
  start_date     date NOT NULL,
  end_date       date,
  is_extension   boolean NOT NULL DEFAULT false,
  -- The gate decision. Empty while the phase is open.
  result         text,
  result_reason  text,
  review_doc_url text,
  reviewed_by    bigint REFERENCES users (id) ON DELETE RESTRICT,
  decided_at     timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  created_by     bigint REFERENCES users (id) ON DELETE RESTRICT,
  updated_by     bigint REFERENCES users (id) ON DELETE RESTRICT,

  CONSTRAINT phase_history_phase_valid
    CHECK (phase IN ('evaluation', 'probation', 'junior', 'senior')),
  CONSTRAINT phase_history_result_valid CHECK (result IN ('pass', 'extend', 'discontinue')),
  -- Evaluation and probation always have an end date. Senior never has one.
  -- Junior has one once it is entered (its length is not confirmed).
  CONSTRAINT phase_history_end_date_required
    CHECK (phase NOT IN ('evaluation', 'probation') OR end_date IS NOT NULL),
  CONSTRAINT phase_history_senior_open_ended CHECK (phase <> 'senior' OR end_date IS NULL),
  CONSTRAINT phase_history_end_after_start CHECK (end_date IS NULL OR end_date >= start_date),
  -- From the guide's gate table: only probation can be extended, and the
  -- senior phase has no gate decision.
  CONSTRAINT phase_history_extend_only_probation CHECK (result <> 'extend' OR phase = 'probation'),
  CONSTRAINT phase_history_extension_only_probation CHECK (NOT is_extension OR phase = 'probation'),
  CONSTRAINT phase_history_senior_has_no_gate CHECK (phase <> 'senior' OR result IS NULL),
  -- A pass hands over to the next phase on the day after this one ends.
  CONSTRAINT phase_history_pass_needs_end_date CHECK (result <> 'pass' OR end_date IS NOT NULL),
  -- "Status = Discontinued; reason required".
  CONSTRAINT phase_history_discontinue_reason
    CHECK (result <> 'discontinue' OR btrim(coalesce(result_reason, '')) <> ''),
  CONSTRAINT phase_history_decision_complete CHECK (
    (result IS NULL AND decided_at IS NULL AND reviewed_by IS NULL)
    OR (result IS NOT NULL AND decided_at IS NOT NULL)
  ),
  CONSTRAINT phase_history_result_reason_length CHECK (char_length(result_reason) <= 1000),
  CONSTRAINT phase_history_review_doc_url_format
    CHECK (review_doc_url ~ '^https?://[^[:space:]]+$' AND char_length(review_doc_url) <= 500)
);

-- At most one open phase per employee.
CREATE UNIQUE INDEX phase_history_one_open_phase ON phase_history (employee_id) WHERE result IS NULL;
CREATE INDEX phase_history_employee_id_idx ON phase_history (employee_id, start_date);
CREATE INDEX phase_history_end_date_idx ON phase_history (end_date);
