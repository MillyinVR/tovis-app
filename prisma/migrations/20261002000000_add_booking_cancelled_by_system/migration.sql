-- Booking.cancelledBySystem — explicit provenance for a platform cancel.
--
-- `cancelledByRole = null` was carrying two different meanings: "cancelled
-- before the provenance columns existed" (policy unknowable) and "cancelled by
-- a sweep" (policy known: the client did nothing wrong, so she is made whole).
-- The refund-retry sweep refused both, so a Stripe failure on an expiry refund
-- left a client's deposit stranded with no path to re-drive it.
--
-- Additive and forward-only: existing rows take FALSE, so a genuinely unknown
-- historical cancel keeps being refused. Only new system cancels set it.
ALTER TABLE "Booking"
  ADD COLUMN "cancelledBySystem" BOOLEAN NOT NULL DEFAULT false;
