-- Engagement loop: client→client follow activity ("started following you").
-- Additive enum value only (new NotificationEventKey member). No table or
-- data change. Safe to apply online — mirrors 20260619020000 (CLIENT_LOOK).

-- AlterEnum
ALTER TYPE "NotificationEventKey" ADD VALUE 'CLIENT_FOLLOW';
