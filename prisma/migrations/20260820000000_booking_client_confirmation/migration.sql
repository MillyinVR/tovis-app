-- K11: client-confirmation loop state — three orthogonal timestamps on Booking.
--
-- 🔴 Deliberately NOT a BookingStatus value: that enum sits inside the
-- Booking_no_active_professional_overlap GIST predicate, closeout, refunds and
-- every write-boundary guard, and a client failing to confirm must never free
-- the slot. These columns are display/loop state only; the overlap constraint
-- does not reference them (pinned by tests/integration/client-confirmation-overlap.test.ts).
--
-- Additive + nullable, no backfill: null on all three means "confirmation was
-- never requested", which is true for every existing row. Writers land in K12.

ALTER TABLE "Booking"
  ADD COLUMN "clientConfirmationRequestedAt" TIMESTAMP(3),
  ADD COLUMN "clientConfirmedAt" TIMESTAMP(3),
  ADD COLUMN "clientConfirmationDeclinedAt" TIMESTAMP(3);
