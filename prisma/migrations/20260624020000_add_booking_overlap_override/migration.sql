-- Make the booking/hold overlap EXCLUDE constraints override-aware.
--
-- The app's overlap policy (lib/booking/overlapPolicy.ts) lets a PRO/ADMIN
-- intentionally double-book, and lets an aftercare pre-selected slot land on an
-- occupied time. But Booking_no_active_professional_overlap (20260522000000) is
-- unconditional, so those authorized overlaps hit a raw 23P01 → unhandled 500.
--
-- Fix: add an `allowsOverlap` flag (written ONLY by the write boundary, derived
-- from the overlap-policy decision) and exclude flagged rows from the
-- constraint. A row with allowsOverlap = true leaves the GIST index entirely, so
-- it neither conflicts with nor blocks any other row — exactly the "authorized
-- overlap" semantics. Normal rows (allowsOverlap = false) still get the full
-- durable no-double-book guarantee, including against races and direct writes.
--
-- Reuses btree_gist + tovis_booking_overlap_range() from 20260522000000.

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- 1. Columns (default false = current behavior; backfill is a no-op).
ALTER TABLE "Booking"
  ADD COLUMN IF NOT EXISTS "allowsOverlap" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "BookingHold"
  ADD COLUMN IF NOT EXISTS "allowsOverlap" BOOLEAN NOT NULL DEFAULT false;

-- 2. Recreate the Booking constraint with the override-aware predicate.
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
    AND NOT "allowsOverlap"
  );

-- 3. Recreate the BookingHold constraint with the same override-aware predicate.
ALTER TABLE "BookingHold"
  DROP CONSTRAINT IF EXISTS "BookingHold_no_active_professional_overlap";

ALTER TABLE "BookingHold"
  ADD CONSTRAINT "BookingHold_no_active_professional_overlap"
  EXCLUDE USING gist (
    "professionalId" WITH =,
    "tovis_booking_overlap_range"(
      "scheduledFor",
      "durationMinutesSnapshot",
      "bufferMinutesSnapshot"
    ) WITH &&
  )
  WHERE (
    NOT "allowsOverlap"
  );
