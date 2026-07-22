-- F14 (Tori, 2026-07-21): "if a pro chooses a time it should reserve the spot."
--
-- A waitlist offer is a pro-CHOSEN concrete time, so it now places a BookingHold
-- over the offered window. This column links that hold back to its offer so the
-- reservation can be released precisely when the offer stops being live, and so
-- the two hold paths that must skip it can tell it apart from a client's own
-- self-service hold:
--   * deleteActiveHoldsForClient (one active hold per client) must NOT drop an
--     offer's reservation when that client starts an unrelated booking;
--   * releaseHold (DELETE /api/v1/holds/[id]) must not let the client
--     un-reserve the slot without declining the offer.
--
-- Nullable + no backfill: every existing hold is a client-picked hold. Cascade
-- because a reservation cannot outlive the offer it belongs to.

ALTER TABLE "BookingHold"
  ADD COLUMN IF NOT EXISTS "waitlistOfferId" TEXT;

-- One hold per offer.
CREATE UNIQUE INDEX IF NOT EXISTS "BookingHold_waitlistOfferId_key"
  ON "BookingHold"("waitlistOfferId");

ALTER TABLE "BookingHold"
  DROP CONSTRAINT IF EXISTS "BookingHold_waitlistOfferId_fkey";

ALTER TABLE "BookingHold"
  ADD CONSTRAINT "BookingHold_waitlistOfferId_fkey"
  FOREIGN KEY ("waitlistOfferId") REFERENCES "WaitlistOffer"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
