-- AlterEnum
-- §6.7 cadence-timed rebook prompt re-engagement trigger (personalization spec
-- §6.7/§8.1). Additive enum value — safe, no data change.
ALTER TYPE "NotificationEventKey" ADD VALUE 'REBOOK_CADENCE_DUE';
