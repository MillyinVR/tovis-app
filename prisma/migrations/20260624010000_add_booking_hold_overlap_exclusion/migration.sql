-- Add database-level protection against overlapping holds for a professional.
--
-- App-level hold creation already serializes per professional via the
-- pg_advisory_xact_lock schedule lock (lib/booking/scheduleLock.ts) and checks
-- conflicts before insert. This constraint mirrors
-- Booking_no_active_professional_overlap and makes the invariant durable
-- against races, retries, future route bugs, scripts, workers, and direct
-- database writes.
--
-- WHY NO "WHERE active" PREDICATE:
-- Holds have no status enum; liveness is purely expiresAt > now(). A GIST
-- EXCLUDE predicate must be IMMUTABLE, so the constraint cannot be scoped to
-- "unexpired" holds via now(). It does not need to be: a hold's scheduled range
-- is immutable after insert, so any two holds that coexist for the same
-- professional were non-overlapping at insert time and stay non-overlapping as
-- they expire. The constraint therefore covers ALL rows and remains
-- self-consistent regardless of expiry. Expired-but-unswept holds are deleted
-- inline (deleteExpiredHoldsForProfessional) before each insert and globally by
-- the 5-min hold-cleanup cron, so a stale expired hold never spuriously blocks a
-- new hold on a just-freed slot.
--
-- Reuses btree_gist + tovis_booking_overlap_range() from
-- 20260522000000_add_booking_overlap_exclusion.

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Sweep expired holds first so no stale overlapping pair (only possible under
-- the pre-constraint exact-start-only unique guard) can block ADD CONSTRAINT.
DELETE FROM "BookingHold" WHERE "expiresAt" <= now();

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
  );
