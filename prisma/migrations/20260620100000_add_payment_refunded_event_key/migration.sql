-- Refund receipt notification: add PAYMENT_REFUNDED to NotificationEventKey.
-- Additive enum value only (new NotificationEventKey member). No table or
-- data change. Safe to apply online — mirrors 20260619030000 (CLIENT_FOLLOW).

-- AlterEnum
ALTER TYPE "NotificationEventKey" ADD VALUE 'PAYMENT_REFUNDED';
