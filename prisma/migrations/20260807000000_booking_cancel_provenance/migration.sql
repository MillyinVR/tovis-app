-- Booking cancellation provenance (docs/design/payment-booking-integrity-audit-plan.md, M1).
--
-- A Stripe success webhook can land AFTER the booking it pays was cancelled
-- (webhook delay/outage, requeue replay, orphan recovery). The cancel-time
-- refund helpers skip a payment that has not landed locally yet, so the money
-- sticks to a CANCELLED booking with nothing to refund it. The late-arriving
-- success handler is the one place that knows both facts — but to run the SAME
-- refund policy the cancel would have run (admin always / pro never / client
-- only >=24h out, deposit policy split by actor) it must know WHO cancelled and
-- WHEN. Until now the cancel stamped only status=CANCELLED.
--
-- Both columns are nullable: bookings cancelled before this migration, and
-- system cancels with no acting role (imported-booking resync), stay null — the
-- late-capture refund path alerts on those instead of guessing policy.

ALTER TABLE "Booking" ADD COLUMN "cancelledAt" TIMESTAMP(3);
ALTER TABLE "Booking" ADD COLUMN "cancelledByRole" "Role";
