-- Booking follow-through counts on the per-pro badge aggregate behind the Looks
-- feed pro_reliability ranking term (personalization spec §4.2). Refreshed hourly
-- by the EXISTING pro-badge-stats job (lib/looks/badges/stats.ts) via a 4th
-- grouped Booking query — no new cron. resolvedBookingCount counts COMPLETED +
-- CANCELLED bookings in the trailing 180 days (NO_SHOW is client behaviour, not
-- pro reliability, so it is excluded); completedResolvedCount is the COMPLETED
-- subset. Additive columns with safe defaults — safe on a live DB; both read as
-- 0 until the next refresh recomputes the table.

-- AlterTable
ALTER TABLE "ProfessionalBadgeStat"
  ADD COLUMN "resolvedBookingCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "completedResolvedCount" INTEGER NOT NULL DEFAULT 0;
