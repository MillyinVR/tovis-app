-- A COMPLETED booking occupies the professional's calendar: widen the Booking
-- overlap EXCLUDE predicate so the durable backstop covers every status the app
-- already refuses on.
--
-- Background (docs/design/scheduling-conflict-audit-fix-plan.md, F8). Four
-- definitions of "statuses that occupy a professional's calendar" had drifted:
--
--   BOOKING_BLOCKING_STATUSES (lib/booking/constants.ts)  PENDING ACCEPTED IN_PROGRESS COMPLETED
--   this constraint (20260624020000)                      PENDING ACCEPTED IN_PROGRESS
--   pro busy-days route                                   PENDING ACCEPTED IN_PROGRESS
--   look-ranking availability aggregates                  PENDING ACCEPTED IN_PROGRESS
--
-- The app was the stricter side, so nothing unsafe ever slipped through the
-- normal write paths — but the durable backstop covered only 3 of the 4
-- statuses the app enforces, so a COMPLETED-row overlap arriving via a race, a
-- script, or a direct database write had nothing to stop it.
--
-- Tori's ruling (2026-07-21): a COMPLETED booking DOES occupy its time. The
-- pro's post-service buffer is real cleanup/travel time and must not become
-- bookable the instant they close out — advanceNoticeMinutes defaults to 15, so
-- dropping COMPLETED from the app set would have exposed that tail to a
-- client booking. The database therefore moves to the app, and all four
-- definitions become PENDING/ACCEPTED/IN_PROGRESS/COMPLETED.
--
-- CANCELLED and NO_SHOW stay out on purpose: that time is genuinely free.
--
-- SAFETY. Widening the predicate pulls previously-exempt COMPLETED rows into
-- the index, so ADD CONSTRAINT fails if a professional already holds an
-- overlapping pair where at least one row is COMPLETED and neither is flagged
-- allowsOverlap. Checked against production before writing this migration: 22
-- bookings, 8 COMPLETED (all unflagged), and ZERO such pairs. A loud failure
-- here is the correct outcome if that ever stops being true — the alternative
-- (quietly stamping the offenders allowsOverlap) would forgive the exact
-- double-book this constraint exists to prevent.
--
-- No new violation can arise from the lifecycle itself: COMPLETED is reachable
-- only from IN_PROGRESS (lib/booking/lifecycleContract.ts), which is already in
-- the index over the identical range, and completion does not move
-- scheduledFor / totalDurationMinutes / bufferMinutes.
--
-- Rows flagged allowsOverlap = true (authorized pro double-books) remain exempt,
-- unchanged. BookingHold is untouched: holds carry no status, so its predicate
-- is `NOT allowsOverlap` alone.
--
-- Reuses btree_gist + tovis_booking_overlap_range() from 20260522000000.

CREATE EXTENSION IF NOT EXISTS btree_gist;

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
      'IN_PROGRESS'::"BookingStatus",
      'COMPLETED'::"BookingStatus"
    )
    AND NOT "allowsOverlap"
  );
