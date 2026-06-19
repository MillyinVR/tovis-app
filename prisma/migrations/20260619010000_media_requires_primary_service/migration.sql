-- Enforce: every MediaAsset is anchored to a primary bookable service, so all
-- media can route to "book this pro". Expand -> backfill -> contract so it's safe
-- on existing rows. (License/verification docs are NOT MediaAssets — unaffected.)

-- 1. Expand: add the column nullable.
ALTER TABLE "MediaAsset" ADD COLUMN "primaryServiceId" TEXT;

-- 2. Backfill from the most authoritative service available, in priority order.
--    a) booking session photos -> the booking's service
UPDATE "MediaAsset" ma
SET "primaryServiceId" = b."serviceId"
FROM "Booking" b
WHERE ma."bookingId" = b.id AND ma."primaryServiceId" IS NULL;

--    b) review photos -> the reviewed booking's service
UPDATE "MediaAsset" ma
SET "primaryServiceId" = rb."serviceId"
FROM "Review" r
JOIN "Booking" rb ON rb.id = r."bookingId"
WHERE ma."reviewId" = r.id AND ma."primaryServiceId" IS NULL;

--    c) portfolio/other -> the first explicitly tagged service
UPDATE "MediaAsset" ma
SET "primaryServiceId" = t."serviceId"
FROM (
  SELECT DISTINCT ON ("mediaId") "mediaId", "serviceId"
  FROM "MediaServiceTag"
  ORDER BY "mediaId", "id"
) t
WHERE ma.id = t."mediaId" AND ma."primaryServiceId" IS NULL;

-- 3. Contract: enforce NOT NULL. Fails loudly if any row is still unbackfilled
--    (intentional — surfaces orphan media instead of silently defaulting).
ALTER TABLE "MediaAsset" ALTER COLUMN "primaryServiceId" SET NOT NULL;

-- Index + FK (exact names/actions Prisma expects so future diffs stay clean).
CREATE INDEX "MediaAsset_primaryServiceId_idx" ON "MediaAsset"("primaryServiceId");
ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_primaryServiceId_fkey" FOREIGN KEY ("primaryServiceId") REFERENCES "Service"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
