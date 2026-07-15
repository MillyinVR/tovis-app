-- AlterEnum
-- §6.8 saved-not-booked activation trigger (personalization spec §6.8/§8.1).
-- Additive enum value — safe, no data change.
ALTER TYPE "NotificationEventKey" ADD VALUE 'SAVED_LOOK_AVAILABILITY_OPENED';
