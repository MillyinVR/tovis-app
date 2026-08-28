-- Lets a waitlist offer carry the MOBILE trip it is promising: the client
-- service address it would travel to, plus the two pro-facing scalars that
-- describe that trip before the client has accepted it.
--
-- Why the columns exist: `WaitlistOffer` had nowhere to put a client address, so
-- `confirmClientWaitlistOffer` booked with `clientAddressId: null` and
-- `assertMobileBookingWithinRadius` threw CLIENT_SERVICE_ADDRESS_REQUIRED for
-- any MOBILE booking without one. A MOBILE offer could therefore be created and
-- then be impossible for the client to accept, which is why
-- WAITLIST_FULFILLABLE_MODES (lib/waitlist/hostability.ts) refused to include
-- MOBILE at all. These columns are the missing half of that plumbing.
--
-- Why distance/area are STORED rather than derived on read: the pro must not see
-- the client's exact address while the offer is merely PENDING. Snapshotting the
-- summary means the pro-facing read selects these two scalars and never joins
-- ClientAddress, so the raw address is unreachable from that path instead of
-- only unrendered. "clientDistanceMiles" is the same number the radius gate
-- measured to admit the offer, so the two can never disagree;
-- "clientAreaLabel" is city/state or a postal prefix only — never a street line,
-- and deliberately no coordinates in any form (the ~11m latApprox/lngApprox grid
-- reverse-geocodes to the front door).
--
-- Additive and all-NULL: every existing row is a SALON offer and keeps behaving
-- exactly as it does today — this deploy changes nothing that is already live —
-- and the columns are only ever written when a MOBILE offer is created, so it is
-- safe to run ahead of the code that reads them.
ALTER TABLE "WaitlistOffer" ADD COLUMN "clientAddressId" TEXT;
ALTER TABLE "WaitlistOffer" ADD COLUMN "clientDistanceMiles" DECIMAL(6,2);
ALTER TABLE "WaitlistOffer" ADD COLUMN "clientAreaLabel" TEXT;

-- Prisma does not index a foreign key on its own. Without this, the ON DELETE
-- SET NULL below makes every ClientAddress delete sequentially scan WaitlistOffer.
CREATE INDEX "WaitlistOffer_clientAddressId_idx" ON "WaitlistOffer"("clientAddressId");

-- SET NULL mirrors Booking.clientAddressId and AftercareRebookSlot.clientAddressId:
-- deleting a saved address must not delete the offer, it must strand it, and the
-- client's confirm then refuses cleanly instead of booking a trip to nowhere.
ALTER TABLE "WaitlistOffer"
  ADD CONSTRAINT "WaitlistOffer_clientAddressId_fkey"
  FOREIGN KEY ("clientAddressId") REFERENCES "ClientAddress"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
