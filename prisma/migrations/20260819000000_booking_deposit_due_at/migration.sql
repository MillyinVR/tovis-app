-- K10-B: stamp the unpaid-deposit release deadline on the booking row.
--
-- Until now the release sweep and the "finish your deposit" reminder both
-- re-derived the deadline from env knobs at RUN time (createdAt + 24h). That
-- has two problems the pro-created deposit step makes fatal:
--   1. a knob change silently moves the deadline under every existing PENDING
--      booking (the reserve-from-config / commit-from-row drift), and
--   2. pro-created bookings need a DIFFERENT anchor — max(scheduledFor − 72h,
--      createdAt + 24h) — and the sweep has no way to tell the two populations
--      apart (pro-created rows carry source=DISCOVERY as a mere column default).
-- Stamping the deadline once, at creation, fixes both: the sweep keys on the
-- column and never recomputes.
--
-- New enum value: an unauthenticated deposit-payment token kind, because a
-- pro-created client is often UNCLAIMED (ClientProfile.userId IS NULL) and can
-- never pass the authed deposit checkout route.
ALTER TYPE "ClientActionTokenKind" ADD VALUE 'DEPOSIT_PAYMENT';

-- The pay-link's notification event (EMAIL/SMS magic-link delivery, mirroring
-- CLIENT_CLAIM_INVITE's channel shape for often-unclaimed recipients).
ALTER TYPE "NotificationEventKey" ADD VALUE 'DEPOSIT_PAYMENT_LINK';

ALTER TABLE "Booking" ADD COLUMN "depositDueAt" TIMESTAMP(3);

-- Backfill the rows the sweep is currently ageing on createdAt, with exactly
-- the deadline that arithmetic gives them today (shipped policy: 24h). Rows
-- whose deposit is not PENDING never reach the sweep, so they stay NULL.
UPDATE "Booking"
SET "depositDueAt" = "createdAt" + INTERVAL '24 hours'
WHERE "depositStatus" = 'PENDING'
  AND "depositDueAt" IS NULL;
