-- AlterEnum
-- M5 unpaid-deposit auto-release nudge: a client-facing reminder that a
-- new-client discovery deposit is still unpaid and the booking's hold is about
-- to be auto-released. Additive enum value — safe, no data change.
ALTER TYPE "NotificationEventKey" ADD VALUE 'DEPOSIT_REMINDER';
