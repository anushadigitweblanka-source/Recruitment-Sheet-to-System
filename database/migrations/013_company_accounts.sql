-- Migration 013: company accounts
--
-- The guide's lifecycle: Attended = Yes -> Requested; IT marks Created; HR
-- marks Handed over; on Discontinued / Terminated a Disable action is
-- recorded and the account becomes Disabled when completed.
--
-- The temporary password, if one is kept at all, is stored separately and
-- encrypted (company_account_secrets). It is never in this table, never in a
-- list, report, export, mail or log, and it is deleted when the employee has
-- changed it.

CREATE TABLE company_accounts (
  id                   bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  candidate_id         bigint NOT NULL REFERENCES candidates (id) ON DELETE RESTRICT,
  employee_id          bigint REFERENCES employees (id) ON DELETE RESTRICT,
  -- Empty until IT has created the account.
  company_email        text,
  status               text NOT NULL DEFAULT 'requested',
  requested_at         timestamptz NOT NULL DEFAULT now(),
  created_by           bigint REFERENCES users (id) ON DELETE RESTRICT,
  created_date         date,
  handed_over_by       bigint REFERENCES users (id) ON DELETE RESTRICT,
  handed_over_date     date,
  -- Set when the employee leaves; the account is Disabled once completed.
  disable_requested_at timestamptz,
  disabled_by          bigint REFERENCES users (id) ON DELETE RESTRICT,
  disabled_date        date,
  updated_at           timestamptz NOT NULL DEFAULT now(),
  updated_by           bigint REFERENCES users (id) ON DELETE RESTRICT,

  -- One account per candidate.
  CONSTRAINT company_accounts_candidate_key UNIQUE (candidate_id),
  CONSTRAINT company_accounts_status_valid
    CHECK (status IN ('requested', 'created', 'handed_over', 'disabled')),
  CONSTRAINT company_accounts_email_normalized CHECK (company_email = lower(btrim(company_email))),
  CONSTRAINT company_accounts_email_format
    CHECK (company_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  -- An account that has been created or handed over has an address and a date.
  CONSTRAINT company_accounts_created_has_details CHECK (
    status IN ('requested', 'disabled') OR (company_email IS NOT NULL AND created_date IS NOT NULL)
  ),
  CONSTRAINT company_accounts_handed_over_has_date CHECK (
    status <> 'handed_over' OR handed_over_date IS NOT NULL
  ),
  CONSTRAINT company_accounts_disabled_has_date CHECK (
    status <> 'disabled' OR disabled_date IS NOT NULL
  )
);

CREATE INDEX company_accounts_employee_id_idx ON company_accounts (employee_id);
CREATE INDEX company_accounts_status_idx ON company_accounts (status);

-- The temporary password, AES-256-GCM encrypted by the application with a key
-- that comes from the environment. Only ciphertext, nonce and tag are kept;
-- the key is never stored here. At most one per account.
CREATE TABLE company_account_secrets (
  account_id bigint PRIMARY KEY REFERENCES company_accounts (id) ON DELETE CASCADE,
  ciphertext bytea NOT NULL,
  iv         bytea NOT NULL,
  auth_tag   bytea NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by bigint REFERENCES users (id) ON DELETE RESTRICT,
  CONSTRAINT company_account_secrets_iv_length CHECK (octet_length(iv) = 12),
  CONSTRAINT company_account_secrets_tag_length CHECK (octet_length(auth_tag) = 16)
);
