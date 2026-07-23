-- Booking deposit-charge dispute freeze (docs/design/payment-booking-integrity-audit-plan.md, M4).
--
-- A Stripe dispute (chargeback) on the DEPOSIT PaymentIntent matched no booking:
-- the dispute handler resolved bookings only by the final-bill PI (stripePaymentIntentId)
-- + the event hint, and dispute events carry no bookingId. So a deposit dispute
-- returned handled:false — no freeze, no alert — while Stripe pulled the funds,
-- and refundDiscoveryDeposit (which gates on depositStatus, not any dispute flag)
-- would then double-return the deposit on a later cancel/retry.
--
-- The deposit rides its OWN charge/PI, distinct from the final bill, so its
-- dispute cannot reuse stripePaymentStatus=DISPUTED (that field describes the
-- final-bill PI). This column is the deposit's equivalent freeze: set on a
-- deposit-PI dispute OPEN/LOST, cleared on WON. While set, the deposit refund
-- path and the M3 retry sweep refuse to move money.
--
-- Nullable + additive: existing rows stay null (no deposit dispute), so no
-- backfill and no behaviour change for undisputed deposits.

ALTER TABLE "Booking" ADD COLUMN "depositDisputedAt" TIMESTAMP(3);
