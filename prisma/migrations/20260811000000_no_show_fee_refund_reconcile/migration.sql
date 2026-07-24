-- No-show / late-cancel fee refund + dispute reconciliation
-- (docs/design/payment-booking-integrity-audit-plan.md, M15 GAP B).
--
-- The fee rides its OWN PaymentIntent (noShowFeeStripePaymentIntentId), distinct
-- from the final bill and the deposit. Nothing read that PI, so a Stripe-side
-- refund (charge.refunded) or chargeback (charge.dispute.*) on the fee charge was
-- a clean no-op: the money moved but noShowFeeStatus stayed CHARGED forever and
-- the money trail kept reading "charged". These columns are the fee PI's honesty
-- fields, mirroring the deposit's depositRefundedCents / depositDisputedAt:
--
--   - noShowFeeRefundedCents: Stripe's authoritative cumulative refund on the fee
--     charge (integer cents), advanced monotonically. A FULL refund also flips
--     noShowFeeStatus to the new REFUNDED value; a sub-fee partial stays CHARGED
--     and only accumulates cents.
--   - noShowFeeDisputedAt: set on a fee-PI dispute OPEN/LOST, cleared on WON — a
--     disputed fee must never render as money safely collected.
--
-- All additive: the enum value is new; the cents column defaults to 0 (no charge
-- has ever refunded — 0 fee statuses in prod); the dispute column is nullable.
-- Inert unless ENABLE_NO_SHOW_PROTECTION is on. No backfill, no behaviour change
-- for any existing row.

-- AlterEnum
ALTER TYPE "NoShowFeeStatus" ADD VALUE 'REFUNDED';

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN "noShowFeeRefundedCents" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Booking" ADD COLUMN "noShowFeeDisputedAt" TIMESTAMP(3);
