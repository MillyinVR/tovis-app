-- K12: the confirmation loop's actions — two additive enum values.
--
-- ClientActionTokenKind.APPOINTMENT_CONFIRMATION: the confirm/cancel/reschedule
-- action link appointment reminders carry (/client/appointment/<token>). Rows
-- are minted at reminder-processing time (the ask), not single-use, and expire
-- at the appointment start.
--
-- NotificationEventKey.APPOINTMENT_CONFIRMATION_DECLINED: pro-facing "client
-- can't make it" notice. D5: the slot stays occupied — declining never cancels;
-- this notification is how the pro learns and decides.
--
-- Enum value adds are non-transactional in Postgres but safe standalone; no
-- table rewrites, no backfill.

ALTER TYPE "ClientActionTokenKind" ADD VALUE 'APPOINTMENT_CONFIRMATION';
ALTER TYPE "NotificationEventKey" ADD VALUE 'APPOINTMENT_CONFIRMATION_DECLINED';
