-- Add optional client-supplied idempotency key for booking-creation dedupe.
-- The unique index uses Postgres default NULLS DISTINCT semantics, so existing
-- rows with NULL keys (and any future rows where the caller does not supply a
-- key) do not conflict. Only two non-null identical (clientId, key) pairs do.
--
-- Reviewed for safety:
-- - ADD COLUMN with no NOT NULL / DEFAULT is metadata-only in Postgres, no row rewrite.
-- - CREATE UNIQUE INDEX scans the table; safe at low volumes (pre-launch). For a
--   live high-volume table, prefer CREATE UNIQUE INDEX CONCURRENTLY in a
--   separate non-transactional migration.

ALTER TABLE "Booking"
  ADD COLUMN IF NOT EXISTS "creationIdempotencyKey" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "Booking_clientId_creationIdempotencyKey_key"
  ON "Booking"("clientId", "creationIdempotencyKey");
