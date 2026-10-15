-- Migration 014: in-app notification read state
--
-- The in-app alert bell shows the reminders the scheduler already creates
-- (notifications, migration 008) to the signed-in user they are addressed to.
-- Whether THIS user has read an alert is personal, so it is kept in its own
-- table: one row per (notification, user). Nothing about the notification
-- itself, the email log or the scheduler changes.
--
-- Which users an alert is for is decided in code, not here: a user is a
-- recipient when their login email is in the notification's recipients or
-- cc_recipients, or when they are the login linked to the Team Lead whose
-- address is in them. No recipient-to-user mapping is stored or guessed.
--
-- The primary key makes a second "read" mark for the same user impossible.
-- Nothing is seeded.

CREATE TABLE notification_reads (
  notification_id bigint NOT NULL REFERENCES notifications (id) ON DELETE RESTRICT,
  user_id         bigint NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  read_at         timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (notification_id, user_id)
);

CREATE INDEX notification_reads_user_idx ON notification_reads (user_id, read_at);
