-- Migration 001: identity foundation
--
-- Who can sign in (users, user_credentials, user_sessions), what they may do
-- (roles, permissions, role_permissions) and a record of what happened
-- (audit_log). No recruitment tables are created here.

-- ---------------------------------------------------------------------------
-- Roles and permissions
-- ---------------------------------------------------------------------------

CREATE TABLE roles (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code        text NOT NULL,
  name        text NOT NULL,
  description text,
  CONSTRAINT roles_code_key UNIQUE (code),
  CONSTRAINT roles_code_format CHECK (code ~ '^[a-z][a-z0-9_]*$'),
  CONSTRAINT roles_name_not_blank CHECK (btrim(name) <> '')
);

CREATE TABLE permissions (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code        text NOT NULL,
  description text,
  CONSTRAINT permissions_code_key UNIQUE (code),
  -- "area.action", for example "candidates.view"
  CONSTRAINT permissions_code_format CHECK (code ~ '^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$')
);

CREATE TABLE role_permissions (
  role_id       bigint NOT NULL REFERENCES roles (id) ON DELETE CASCADE,
  permission_id bigint NOT NULL REFERENCES permissions (id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

CREATE INDEX role_permissions_permission_id_idx ON role_permissions (permission_id);

-- ---------------------------------------------------------------------------
-- Users
-- ---------------------------------------------------------------------------

-- No password of any kind is stored in this table.
CREATE TABLE users (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email         text NOT NULL,
  full_name     text NOT NULL,
  role_id       bigint NOT NULL REFERENCES roles (id) ON DELETE RESTRICT,
  is_active     boolean NOT NULL DEFAULT true,
  last_login_at timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  created_by    bigint REFERENCES users (id) ON DELETE RESTRICT,
  updated_by    bigint REFERENCES users (id) ON DELETE RESTRICT,
  -- Emails are always stored trimmed and in lower case, so two spellings of
  -- the same address can never become two users.
  CONSTRAINT users_email_key UNIQUE (email),
  CONSTRAINT users_email_normalized CHECK (email = lower(btrim(email))),
  CONSTRAINT users_email_format CHECK (email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  CONSTRAINT users_full_name_not_blank CHECK (btrim(full_name) <> '')
);

CREATE INDEX users_role_id_idx ON users (role_id);

-- Sign-in details, kept apart from users so they are never read by accident
-- and can be replaced if the sign-in method changes.
CREATE TABLE user_credentials (
  user_id               bigint PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  password_hash         text NOT NULL,
  password_changed_at   timestamptz NOT NULL DEFAULT now(),
  must_change_password  boolean NOT NULL DEFAULT false,
  failed_login_attempts integer NOT NULL DEFAULT 0,
  locked_until          timestamptz,
  -- Only an Argon2id hash can be stored; a plain password is refused.
  CONSTRAINT user_credentials_hash_is_argon2id CHECK (password_hash LIKE '$argon2id$%'),
  CONSTRAINT user_credentials_attempts_not_negative CHECK (failed_login_attempts >= 0)
);

-- One row per signed-in browser. Only a SHA-256 hash of the session token is
-- stored, so a copy of this table cannot be used to sign in.
CREATE TABLE user_sessions (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id      bigint NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash   text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  CONSTRAINT user_sessions_token_hash_key UNIQUE (token_hash),
  CONSTRAINT user_sessions_token_hash_format CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT user_sessions_expiry_after_start CHECK (expires_at > created_at)
);

CREATE INDEX user_sessions_user_id_idx ON user_sessions (user_id);
CREATE INDEX user_sessions_expires_at_idx ON user_sessions (expires_at);

-- ---------------------------------------------------------------------------
-- Audit log
-- ---------------------------------------------------------------------------

-- Append-only: the application inserts rows and never updates or deletes them.
-- Passwords, hashes and tokens must never be written here.
CREATE TABLE audit_log (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_user_id bigint REFERENCES users (id) ON DELETE RESTRICT, -- NULL = system or unknown
  action        text NOT NULL,
  entity_type   text,
  entity_id     bigint,
  old_values    jsonb,
  new_values    jsonb,
  details       jsonb,
  occurred_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT audit_log_action_format CHECK (action ~ '^[A-Z][A-Z0-9_]*$')
);

CREATE INDEX audit_log_actor_user_id_idx ON audit_log (actor_user_id);
CREATE INDEX audit_log_entity_idx ON audit_log (entity_type, entity_id);
CREATE INDEX audit_log_occurred_at_idx ON audit_log (occurred_at);

-- ---------------------------------------------------------------------------
-- Starting data
-- ---------------------------------------------------------------------------

-- Only the role needed to test sign-in. The task guide's other roles (HR,
-- Team Lead, Intern / Dev) are added once their permissions are approved.
INSERT INTO roles (code, name, description)
VALUES ('main_user', 'Main User', 'Sees and manages everything, including users.');

INSERT INTO permissions (code, description) VALUES
  ('candidates.view',      'View candidates'),
  ('candidates.edit',      'Add and edit candidates'),
  ('interviews.manage',    'Record phone and direct interviews'),
  ('offers.manage',        'Create and update offers'),
  ('employees.manage',     'View and update the employee lifecycle'),
  ('notifications.manage', 'Manage notifications, email templates and the email log'),
  ('admin.manage',         'Manage users, roles and settings'),
  -- Salary is protected by its own permissions. Nothing uses them yet.
  ('salary.view',          'View salary'),
  ('salary.edit',          'Edit salary');

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r CROSS JOIN permissions p
WHERE r.code = 'main_user';
