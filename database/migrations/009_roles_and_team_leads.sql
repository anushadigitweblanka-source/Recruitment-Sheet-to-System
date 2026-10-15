-- Migration 009: the guide's roles, their permissions, and the Team Lead mapping
--
-- Roles (task guide, access-control section):
--   Main User   HR head / owner. Sees everything including salary, all actions,
--               manages users, approves offer mails, all reports.
--   HR          Recruiters. See all candidates and interviews, no salary,
--               add and edit candidates, enter results, send mails.
--   Team Lead   One per team. Sees only their own team's candidates and scores,
--               no salary, adds interview comments and scores, receives
--               invitations.
--   Intern/Dev  The builder. Test data only; builds and tests.
--
-- Roles and permissions already in use are not changed; this only adds.
-- Salary stays Main User only: salary.view / salary.edit from migration 001
-- are granted to nobody else.

-- ---------------------------------------------------------------------------
-- New permissions
-- ---------------------------------------------------------------------------

INSERT INTO permissions (code, description) VALUES
  ('candidates.view_team',     'View only the candidates and interviews of the team the user leads'),
  ('interviews.score',         'Add interview comments and scores for the user''s own team'),
  ('company_accounts.manage',  'Request, create, hand over and disable company accounts'),
  ('company_accounts.password','Reveal, edit and reset a company account''s temporary password');

-- ---------------------------------------------------------------------------
-- Roles
-- ---------------------------------------------------------------------------

INSERT INTO roles (code, name, description) VALUES
  ('hr', 'HR',
   'Recruiters: see all candidates and interviews, add and edit candidates, enter results, send mails. No salary.'),
  ('team_lead', 'Team Lead',
   'One per team: sees the team''s own candidates and scores and adds interview comments and scores. No salary.'),
  ('intern_dev', 'Intern / Dev',
   'The builder: works with test data only to build and test. No salary, no administration.');

-- Main User keeps everything, including the new permissions.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM roles r CROSS JOIN permissions p
 WHERE r.code = 'main_user'
   AND p.code IN ('candidates.view_team', 'interviews.score',
                  'company_accounts.manage', 'company_accounts.password')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM roles r
  JOIN permissions p ON p.code IN (
         'candidates.view', 'candidates.edit', 'interviews.manage',
         'notifications.manage', 'company_accounts.manage')
 WHERE r.code = 'hr';

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM roles r
  JOIN permissions p ON p.code IN ('candidates.view_team', 'interviews.score')
 WHERE r.code = 'team_lead';

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM roles r
  JOIN permissions p ON p.code IN (
         'candidates.view', 'candidates.edit', 'interviews.manage', 'offers.manage',
         'employees.manage', 'notifications.manage')
 WHERE r.code = 'intern_dev';

-- ---------------------------------------------------------------------------
-- Team Leads
-- ---------------------------------------------------------------------------

-- "team_leads mapping: position or team, team lead name, team lead email".
-- The system picks the Team Lead from the candidate's applied position.
-- user_id (optional) links the Team Lead to a login, which is what limits a
-- Team Lead's screens to their own team. No team lead is seeded.
CREATE TABLE team_leads (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  position_id bigint NOT NULL REFERENCES positions (id) ON DELETE RESTRICT,
  -- Free label for the team, shown next to the position.
  team_name  text,
  name       text NOT NULL,
  email      text NOT NULL,
  user_id    bigint REFERENCES users (id) ON DELETE RESTRICT,
  is_active  boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by bigint REFERENCES users (id) ON DELETE RESTRICT,
  updated_by bigint REFERENCES users (id) ON DELETE RESTRICT,

  -- One Team Lead per position ("one per team").
  CONSTRAINT team_leads_position_key UNIQUE (position_id),
  CONSTRAINT team_leads_name_trimmed CHECK (name = btrim(name) AND name <> ''),
  CONSTRAINT team_leads_name_length CHECK (char_length(name) <= 150),
  CONSTRAINT team_leads_team_name_length CHECK (char_length(team_name) <= 100),
  CONSTRAINT team_leads_email_normalized CHECK (email = lower(btrim(email))),
  CONSTRAINT team_leads_email_format CHECK (email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')
);

CREATE INDEX team_leads_user_id_idx ON team_leads (user_id) WHERE user_id IS NOT NULL;
