-- K10 (D4 = per-service prepay): a service the pro requires PAID IN FULL up front.
--
-- Prepay is not a second payment rail — it is a 100% deposit, so everything
-- downstream (the deposit PaymentIntent, credit-to-total, partial refunds, the
-- dispute freeze, the release sweep, closeout-at-zero) is the machinery K10-A
-- already hardened. All this column does is decide the AMOUNT and widen the gate.
--
-- Stored on the pro↔service JOIN, like `calendarSwatch`: `Service` is a GLOBAL
-- catalog row (`name @unique`) shared by every pro, so no pro can own a column
-- there.
--
-- Nullable with no backfill. NULL means "no prepay requirement" and reproduces
-- pre-K10 behaviour exactly — the booking follows the pro's account-wide
-- `depositScope` and nothing else changes for a pro who never touches this.
CREATE TYPE "OfferingPrepayScope" AS ENUM ('SERVICE_ONLY', 'ENTIRE_BOOKING');

ALTER TABLE "ProfessionalServiceOffering"
  ADD COLUMN "prepayScope" "OfferingPrepayScope";
