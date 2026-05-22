-- Add database-level protection against overlapping active bookings.
--
-- App-level booking write logic already checks conflicts, but this constraint
-- makes the invariant durable against races, retries, future route bugs, scripts,
-- workers, and direct database writes.
--
-- Active bookings for the same professional may not have overlapping scheduled
-- ranges. The range includes service duration plus buffer.

CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE OR REPLACE FUNCTION "tovis_booking_overlap_range"(
  "starts_at" timestamp,
  "duration_minutes" integer,
  "buffer_minutes" integer
)
RETURNS tsrange
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
AS $$
BEGIN
  RETURN tsrange(
    "starts_at",
    "starts_at"
      + (
        GREATEST(
          1,
          COALESCE("duration_minutes", 0) + COALESCE("buffer_minutes", 0)
        ) * INTERVAL '1 minute'
      ),
    '[)'
  );
END;
$$;

ALTER TABLE "Booking"
  DROP CONSTRAINT IF EXISTS "Booking_no_active_professional_overlap";

ALTER TABLE "Booking"
  ADD CONSTRAINT "Booking_no_active_professional_overlap"
  EXCLUDE USING gist (
    "professionalId" WITH =,
    "tovis_booking_overlap_range"(
      "scheduledFor",
      "totalDurationMinutes",
      "bufferMinutes"
    ) WITH &&
  )
  WHERE (
    "status" IN (
      'PENDING'::"BookingStatus",
      'ACCEPTED'::"BookingStatus",
      'IN_PROGRESS'::"BookingStatus"
    )
  );