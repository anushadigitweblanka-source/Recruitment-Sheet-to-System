-- Migration 007: the first Work Mode value.
--
-- "Office" is approved as a temporary value that still requires mentor
-- confirmation. Until then it is the only value the column accepts; a
-- confirmed list replaces this constraint in a new migration.
--
-- No offer row has a work_mode yet (the application refused every value
-- before this migration), so the constraint holds for existing data.

ALTER TABLE offers
  ADD CONSTRAINT offers_work_mode_valid CHECK (work_mode IN ('office'));
