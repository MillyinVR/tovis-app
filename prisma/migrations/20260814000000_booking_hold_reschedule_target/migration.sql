-- B3: mark a hold that was placed to MOVE an existing booking.
--
-- Two jobs. The reservation is sized from the booking's committed
-- `totalDurationMinutes` rather than the offering's current base (those drift
-- whenever a duration is edited, and the reschedule commits the former). And
-- the add-on re-size path, PATCH /api/v1/holds/[id], refuses such a hold: that
-- endpoint recomputes width from the OFFERING, so without this marker an
-- ordinary `addOnIds: []` request would narrow a reschedule hold straight back
-- to the under-reservation this column exists to prevent.
--
-- Additive and nullable; every existing hold reads as "not a reschedule hold",
-- which is what they all are. ON DELETE CASCADE so a deleted booking cannot
-- leave its reservation behind (holds live ~10 minutes regardless).

ALTER TABLE "BookingHold" ADD COLUMN "rescheduleBookingId" TEXT;

CREATE INDEX "BookingHold_rescheduleBookingId_idx"
  ON "BookingHold"("rescheduleBookingId");

ALTER TABLE "BookingHold"
  ADD CONSTRAINT "BookingHold_rescheduleBookingId_fkey"
  FOREIGN KEY ("rescheduleBookingId") REFERENCES "Booking"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
