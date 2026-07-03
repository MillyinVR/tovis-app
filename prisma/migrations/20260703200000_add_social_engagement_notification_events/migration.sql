-- Social notifications for Looks engagement (social-first plan A2):
--  - LOOK_LIKED                 → the look's author (batched, windowed dedupe)
--  - LOOK_SAVED                 → the look's author (batched, windowed dedupe)
--  - LOOK_NEW_FROM_FOLLOWED_PRO → each ProFollow follower on publish
-- Plus the LooksSocialJob type that fans the publish notification out.
--
-- Additive enum values; safe on a live database.
ALTER TYPE "NotificationEventKey" ADD VALUE IF NOT EXISTS 'LOOK_LIKED';
ALTER TYPE "NotificationEventKey" ADD VALUE IF NOT EXISTS 'LOOK_SAVED';
ALTER TYPE "NotificationEventKey" ADD VALUE IF NOT EXISTS 'LOOK_NEW_FROM_FOLLOWED_PRO';
ALTER TYPE "LooksSocialJobType" ADD VALUE IF NOT EXISTS 'FAN_OUT_NEW_LOOK_NOTIFICATIONS';
