-- Track cumulative cents refunded against a booking's discovery-deposit charge.
--
-- Before this, both the app-side deposit refund (refundDiscoveryDeposit) and the
-- charge.refunded webhook (reconcileDepositChargeRefundInTransaction) flipped
-- depositStatus -> REFUNDED on ANY refund amount. A partial refund (e.g. a
-- $5 dashboard refund on a $50 deposit) therefore marked the whole deposit
-- REFUNDED, and a later legitimate full refund was blocked (the app-side claim
-- is `depositStatus PAID -> REFUNDED`, which no-ops once already REFUNDED).
--
-- depositRefundedCents accumulates the deposit-charge cents returned so far so
-- the refund paths can issue partials, only flip depositStatus -> REFUNDED once
-- the full deposit charge has been returned, and never over-refund. Backfill is
-- a no-op: existing REFUNDED deposits were full refunds under the old model, and
-- 0 is the correct "nothing refunded yet" default for everything else.

ALTER TABLE "Booking"
  ADD COLUMN "depositRefundedCents" INTEGER NOT NULL DEFAULT 0;
