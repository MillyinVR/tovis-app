-- Platform fee model (docs/design/membership-value-brief.md §11.5).
--
-- Splits the one-time cold-discovery platform fee into the two fees Tori locked:
--   • "Booking"."discoveryFeeAmount"    — unchanged column, now the CLIENT convenience
--     fee (10% of the deposit, floor $2, cap $10), charged on top of the deposit.
--   • "Booking"."proDiscoveryFeeAmount" — NEW: the pro's $5, collected out of their
--     deposit payout via the same Stripe application fee.
--   • "Booking"."proDiscoveryFeeWaived" — NEW: whether a membership waiver suppressed
--     a pro fee that was otherwise due, so the measurement cohorts can tell a waiver
--     apart from the fees simply being switched off.
--
-- Additive and backfill-free. Existing rows keep proDiscoveryFeeAmount NULL, which
-- reads as "this booking predates the pro fee" — distinct from 0 ("a pro fee was
-- considered and came out at zero"). No fee has ever been charged in production, so
-- there is no historical money to reinterpret.

ALTER TABLE "Booking" ADD COLUMN "proDiscoveryFeeAmount" INTEGER;
ALTER TABLE "Booking" ADD COLUMN "proDiscoveryFeeWaived" BOOLEAN NOT NULL DEFAULT false;
