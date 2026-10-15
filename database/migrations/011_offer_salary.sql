-- Migration 011: offer salary
--
-- "offer_salary table linked to candidate_id." Salary lives only here, apart
-- from the offers table, so offers, reports and exports contain no salary at
-- all and every read of it goes through one guarded module that logs the
-- access. Only the Main User holds salary.view and salary.edit (migration
-- 001 grants them to nobody else).
--
-- No salary value is seeded. Amounts are in LKR.

CREATE TABLE offer_salary (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  candidate_id bigint NOT NULL REFERENCES candidates (id) ON DELETE RESTRICT,
  salary_lkr   numeric(12, 2) NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  created_by   bigint REFERENCES users (id) ON DELETE RESTRICT,
  updated_by   bigint REFERENCES users (id) ON DELETE RESTRICT,

  -- One salary per candidate.
  CONSTRAINT offer_salary_candidate_key UNIQUE (candidate_id),
  CONSTRAINT offer_salary_not_negative CHECK (salary_lkr >= 0)
);
