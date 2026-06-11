-- Track addresses Postmark has marked inactive/suppressed (ErrorCode 406:
-- hard bounce, spam complaint, or manual suppression) so the
-- verification-email retry cron stops retrying them.

ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "emailSendPermanentlyFailedAt" TIMESTAMP(3);
