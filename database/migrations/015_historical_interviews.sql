-- PROPOSED migration 015: historical interview records.
--
-- DESIGN SPECIFICATION ONLY. This file is deliberately NOT in
-- database/migrations, so the migration runner never applies it. It becomes a
-- real migration only after the project owner approves it and the target
-- database. Automated tests load it into their own throwaway schema.
--
-- Why a separate pair of tables: the recruitment CSV is an older interview
-- log (guide section 10, Tab 7). It has no Candidate ID and the people in it
-- cannot safely be merged with, or turned into, current candidates. These
-- tables hold each CSV record exactly as it was read, reference nothing in the
-- live recruitment pipeline (no candidates, offers, employees, interviews,
-- notifications or email), and so cannot trigger any of it.
--
-- Nothing is seeded here except the permission that guards viewing.

CREATE TABLE historical_import_batches (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- The file's base name only, never a path.
  file_name       text NOT NULL,
  -- SHA-256 of the file's bytes: the same file cannot be loaded twice.
  file_sha256     text NOT NULL,
  encoding        text NOT NULL,
  record_count    integer NOT NULL,
  imported_count  integer NOT NULL DEFAULT 0,
  review_count    integer NOT NULL DEFAULT 0,
  status          text NOT NULL DEFAULT 'importing',
  imported_by     bigint REFERENCES users (id) ON DELETE RESTRICT,
  created_at      timestamptz NOT NULL DEFAULT now(),
  completed_at    timestamptz,
  rolled_back_at  timestamptz,
  rolled_back_by  bigint REFERENCES users (id) ON DELETE RESTRICT,

  CONSTRAINT historical_batches_status_valid
    CHECK (status IN ('importing', 'completed', 'rolled_back')),
  CONSTRAINT historical_batches_sha_format CHECK (file_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT historical_batches_counts_valid
    CHECK (record_count >= 0 AND imported_count >= 0 AND review_count >= 0
           AND review_count <= imported_count)
);

-- One live load per file. A rolled-back file may be loaded again.
CREATE UNIQUE INDEX historical_batches_one_live_file
  ON historical_import_batches (file_sha256) WHERE status <> 'rolled_back';

CREATE TABLE historical_interview_records (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  batch_id           bigint NOT NULL REFERENCES historical_import_batches (id) ON DELETE RESTRICT,
  -- Position of the record in the CSV; the header is record 1.
  record_number      integer NOT NULL,
  row_hash           text NOT NULL,

  -- The CSV values exactly as read. Nothing is trimmed, repaired or mapped.
  interview_date_text text,
  candidate_name      text,
  contact_number      text,
  source              text,
  mode                text,
  position            text,
  original_status     text,
  remarks             text,
  -- The one column with no header that holds values.
  extra_value         text,

  -- Only set when the text is an unambiguous day-first date (the guide's rule).
  interview_on        date,
  -- Why the record needs a person's attention. Never a reason to drop it.
  review_flags        text[] NOT NULL DEFAULT '{}',
  created_at          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT historical_records_unique_number UNIQUE (batch_id, record_number),
  CONSTRAINT historical_records_hash_format CHECK (row_hash ~ '^[0-9a-f]{64}$')
);

CREATE INDEX historical_records_batch_idx ON historical_interview_records (batch_id);
CREATE INDEX historical_records_date_idx ON historical_interview_records (interview_on);
CREATE INDEX historical_records_status_idx ON historical_interview_records (original_status);

-- Who may view them: the Main User and HR (never Team Lead or Intern / Dev).
INSERT INTO permissions (code, description)
VALUES ('historical.view', 'View imported historical interview records');

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM roles r CROSS JOIN permissions p
 WHERE r.code IN ('main_user', 'hr') AND p.code = 'historical.view'
ON CONFLICT DO NOTHING;
