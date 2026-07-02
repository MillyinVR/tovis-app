-- Waitlist "Offer a time" client-confirm gate: a pro proposes a concrete
-- appointment time to a waitlisted client who must Confirm before it books.
-- Additive enum value only (new NotificationEventKey member). No table or data
-- change. Kept standalone (mirrors 20260619030000 CLIENT_FOLLOW) so the new
-- value is committed before any migration uses it.

-- AlterEnum
ALTER TYPE "NotificationEventKey" ADD VALUE 'WAITLIST_TIME_OFFERED';
