-- AlterEnum
-- M15 POLICY follow-up: a no-show that keeps the client's captured discovery
-- deposit (the kept deposit IS the penalty, so no separate no-show fee is
-- charged) now tells the client via a NO_SHOW_DEPOSIT_KEPT notification.
-- Additive enum value — safe, no data change; inert until ENABLE_NO_SHOW_PROTECTION.
ALTER TYPE "NotificationEventKey" ADD VALUE 'NO_SHOW_DEPOSIT_KEPT';
