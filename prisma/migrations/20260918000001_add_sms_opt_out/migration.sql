-- SMS opt-out state, keyed by the same HMAC phone lookup hash used by
-- User.phoneHashV2 / ClientProfile.phoneHashV2, so the send-time gate works
-- for ANY destination phone — including pro-entered clients who have no User
-- row and therefore no transactionalSmsConsentAt to revoke.
--
-- Additive only — one new table plus one new index on an existing table;
-- nothing existing changes shape.

CREATE TABLE "SmsOptOut" (
    "id" TEXT NOT NULL,
    "phoneHashV2" VARCHAR(128) NOT NULL,
    "phone" VARCHAR(32),
    "optedOutAt" TIMESTAMP(3),
    "lastKeyword" VARCHAR(32) NOT NULL,
    "lastEventAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SmsOptOut_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SmsOptOut_phoneHashV2_key" ON "SmsOptOut"("phoneHashV2");

CREATE INDEX "SmsOptOut_optedOutAt_idx" ON "SmsOptOut"("optedOutAt");

-- Deny-all lock (no policies), matching every other app table since
-- 20260901000000_enable_rls_and_pin_function_search_path — only the
-- bypassing service role (this app's own Prisma connection) can read/write.
ALTER TABLE "SmsOptOut" ENABLE ROW LEVEL SECURITY;

-- The send-time opt-out gate and the first-message-per-recipient opt-out
-- disclosure check (lib/notifications/delivery/claimDeliveries.ts,
-- processDueDeliveries.ts) both filter NotificationDelivery by
-- (channel, destination).
CREATE INDEX "NotificationDelivery_channel_destination_idx" ON "NotificationDelivery"("channel", "destination");
