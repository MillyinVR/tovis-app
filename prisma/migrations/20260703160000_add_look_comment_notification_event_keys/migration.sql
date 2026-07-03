-- Social notifications for Looks comments (social-first plan A1):
--  - LOOK_COMMENTED       → the look's author (pro, or client author)
--  - LOOK_COMMENT_REPLIED → the parent comment's author (pro or client)
--
-- Additive enum values; safe on a live database.
ALTER TYPE "NotificationEventKey" ADD VALUE IF NOT EXISTS 'LOOK_COMMENTED';
ALTER TYPE "NotificationEventKey" ADD VALUE IF NOT EXISTS 'LOOK_COMMENT_REPLIED';
