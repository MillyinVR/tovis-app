-- P0-A: Add booking hot-path media indexes and aftercare delivery dashboard indexes.
-- Also safely completes the existing IdempotencyKey schema drift surfaced by Prisma.
-- Safe for non-empty tables: actorKey is added nullable, backfilled, then made required.

-- IdempotencyKey schema-history cleanup
ALTER TABLE "IdempotencyKey" DROP CONSTRAINT IF EXISTS "IdempotencyKey_actorUserId_fkey";

ALTER TABLE "IdempotencyKey"
ADD COLUMN IF NOT EXISTS "actorKey" VARCHAR(191);

UPDATE "IdempotencyKey"
SET "actorKey" = COALESCE("actorUserId", 'legacy:' || "id")
WHERE "actorKey" IS NULL;

ALTER TABLE "IdempotencyKey"
ALTER COLUMN "actorKey" SET NOT NULL,
ALTER COLUMN "actorUserId" DROP NOT NULL;

DROP INDEX IF EXISTS "IdempotencyKey_actorUserId_route_key_key";

CREATE INDEX IF NOT EXISTS "IdempotencyKey_actorKey_createdAt_idx"
ON "IdempotencyKey"("actorKey", "createdAt");

CREATE UNIQUE INDEX IF NOT EXISTS "IdempotencyKey_actorKey_route_key_key"
ON "IdempotencyKey"("actorKey", "route", "key");

ALTER TABLE "IdempotencyKey"
ADD CONSTRAINT "IdempotencyKey_actorUserId_fkey"
FOREIGN KEY ("actorUserId") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

-- AftercareSummary indexes
CREATE INDEX IF NOT EXISTS "AftercareSummary_sentToClientAt_createdAt_idx"
ON "AftercareSummary"("sentToClientAt", "createdAt");

CREATE INDEX IF NOT EXISTS "AftercareSummary_bookingId_sentToClientAt_idx"
ON "AftercareSummary"("bookingId", "sentToClientAt");

-- MediaAsset booking hot-path indexes
CREATE INDEX IF NOT EXISTS "MediaAsset_bookingId_phase_createdAt_idx"
ON "MediaAsset"("bookingId", "phase", "createdAt");

CREATE INDEX IF NOT EXISTS "MediaAsset_bookingId_createdAt_idx"
ON "MediaAsset"("bookingId", "createdAt");