-- Add the NO_SHOW terminal booking status (Phase 2 revenue protection). Additive
-- enum value only; existing bookings are untouched. The pro calendar already
-- parses/styles a 'NO_SHOW' status string, so once the enum can hold it the value
-- flows straight through the read path. Separate migration from any use of the
-- value: Postgres requires ADD VALUE to commit before the label can be referenced.
-- Mirrors 20260619030000 (CLIENT_FOLLOW).

-- AlterEnum
ALTER TYPE "BookingStatus" ADD VALUE 'NO_SHOW';
