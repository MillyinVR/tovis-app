-- AftercareSummary.rebookedBookingId: BOOKED_NEXT_APPOINTMENT now creates the
-- real next-appointment Booking at save time; this links the summary to it.
ALTER TABLE "AftercareSummary" ADD COLUMN "rebookedBookingId" TEXT;

CREATE UNIQUE INDEX "AftercareSummary_rebookedBookingId_key"
  ON "AftercareSummary"("rebookedBookingId");

ALTER TABLE "AftercareSummary"
  ADD CONSTRAINT "AftercareSummary_rebookedBookingId_fkey"
  FOREIGN KEY ("rebookedBookingId") REFERENCES "Booking"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
