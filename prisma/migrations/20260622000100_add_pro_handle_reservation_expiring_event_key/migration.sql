-- Heads-up notification before a non-premium pro's reserved vanity handle is
-- released for inactivity: add PRO_HANDLE_RESERVATION_EXPIRING to NotificationEventKey.
-- Additive enum value only. No table or data change. Mirrors 20260620100000.

-- AlterEnum
ALTER TYPE "NotificationEventKey" ADD VALUE 'PRO_HANDLE_RESERVATION_EXPIRING';
