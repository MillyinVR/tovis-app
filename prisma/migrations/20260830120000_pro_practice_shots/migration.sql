-- Pro practice shots — the standalone camera behind the pro footer's centre
-- button when no session is live.
--
-- ⚠️ MIGRATION NOTE: this is PURELY ADDITIVE.
--   • one new enum VALUE on "UploadSurface" ('PRO_PRACTICE'),
--   • one new table, "PracticeShot", which starts EMPTY.
-- Nothing existing is altered, backfilled, dropped or re-typed. No existing row
-- changes, and no existing query's result changes: practice shots are NOT
-- MediaAssets, so every portfolio / Looks / chart / booking-media query is
-- byte-identical before and after this runs. Rolling it back is a DROP TABLE
-- (the enum value would linger harmlessly — Postgres cannot drop an enum value).
--
-- Why a separate table rather than a MediaAsset: every MediaAsset is anchored to
-- a bookable "primaryServiceId" so it can always route to "book this". A shot
-- taken outside a session has no booking and no service, and inventing an anchor
-- would make it surface in every by-service media query. A practice shot becomes
-- a real MediaAsset only when the pro ATTACHES it — which is the moment a
-- service is actually known. See prisma/schema.prisma for the full rationale.

-- AlterEnum
ALTER TYPE "UploadSurface" ADD VALUE 'PRO_PRACTICE';

-- CreateTable
CREATE TABLE "PracticeShot" (
    "id" TEXT NOT NULL,
    "professionalId" TEXT NOT NULL,
    "proTenantId" TEXT,
    "storageBucket" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "mediaType" "MediaType" NOT NULL DEFAULT 'IMAGE',
    "caption" TEXT,
    "focalX" DOUBLE PRECISION,
    "focalY" DOUBLE PRECISION,
    "attachedMediaId" TEXT,
    "attachedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PracticeShot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- One practice shot per stored object, so a retried confirm can never mint two
-- rows over the same bytes (mirrors MediaAsset's own storage-pointer unique).
CREATE UNIQUE INDEX "PracticeShot_storageBucket_storagePath_key" ON "PracticeShot"("storageBucket", "storagePath");

-- CreateIndex
CREATE INDEX "PracticeShot_professionalId_createdAt_idx" ON "PracticeShot"("professionalId", "createdAt");

-- CreateIndex
CREATE INDEX "PracticeShot_proTenantId_idx" ON "PracticeShot"("proTenantId");

-- CreateIndex
CREATE INDEX "PracticeShot_attachedMediaId_idx" ON "PracticeShot"("attachedMediaId");

-- AddForeignKey
ALTER TABLE "PracticeShot" ADD CONSTRAINT "PracticeShot_professionalId_fkey" FOREIGN KEY ("professionalId") REFERENCES "ProfessionalProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PracticeShot" ADD CONSTRAINT "PracticeShot_proTenantId_fkey" FOREIGN KEY ("proTenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
-- SetNull, not Cascade: deleting the attached media must leave the practice shot
-- in the pro's library (it just stops being marked as used).
ALTER TABLE "PracticeShot" ADD CONSTRAINT "PracticeShot_attachedMediaId_fkey" FOREIGN KEY ("attachedMediaId") REFERENCES "MediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;
