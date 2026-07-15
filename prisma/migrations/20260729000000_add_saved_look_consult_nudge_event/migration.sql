-- AlterEnum
-- §6.8 hesitation-consult re-engagement trigger (personalization spec §6.8/§8.1):
-- a client saved a high-/medium-commitment look but never booked → a gentle
-- consult/education nudge. Additive enum value — safe, no data change.
ALTER TYPE "NotificationEventKey" ADD VALUE 'SAVED_LOOK_CONSULT_NUDGE';
