-- Migration 012: Company CV upload links
--
-- The guide's flow: one Company CV template (stored in Settings) goes out with
-- the interview invitation together with a link unique to the candidate. The
-- candidate uploads the filled CV through that link, the result is stored in
-- candidates.company_cv_url and the status becomes Received.
--
-- Only a SHA-256 hash of the link token is stored, so a copy of this table
-- cannot be used to upload. No storage provider is chosen here: files are
-- kept by a storage adapter in the application.

CREATE TABLE company_cv_links (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  candidate_id bigint NOT NULL REFERENCES candidates (id) ON DELETE RESTRICT,
  token_hash   text NOT NULL,
  expires_at   timestamptz NOT NULL,
  used_at      timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  created_by   bigint REFERENCES users (id) ON DELETE RESTRICT,

  CONSTRAINT company_cv_links_token_hash_key UNIQUE (token_hash),
  CONSTRAINT company_cv_links_token_hash_format CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT company_cv_links_expiry_after_start CHECK (expires_at > created_at)
);

CREATE INDEX company_cv_links_candidate_id_idx ON company_cv_links (candidate_id);

-- The Company CV template (a link to the blank form). HR replaces it in
-- Settings without a code change. Empty until set.
INSERT INTO settings (key, value, description) VALUES
  ('company_cv_template_url', '',
   'Link to the blank Company CV template sent with the interview invitation (http or https).');
