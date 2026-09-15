-- CreateEnum
CREATE TYPE "LookMediaAnalysisStatus" AS ENUM ('PENDING', 'PROCESSING', 'NEEDS_PRO', 'NEEDS_ADMIN', 'READY', 'FAILED', 'REJECTED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationEventKey" ADD VALUE 'LOOK_MEDIA_CLARIFICATION';
ALTER TYPE "NotificationEventKey" ADD VALUE 'LOOK_MEDIA_ADMIN_REVIEW';

-- CreateTable
CREATE TABLE "LookMediaAnalysis" (
    "id" TEXT NOT NULL,
    "mediaAssetId" TEXT NOT NULL,
    "sourceHash" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "status" "LookMediaAnalysisStatus" NOT NULL DEFAULT 'PENDING',
    "revision" INTEGER NOT NULL DEFAULT 0,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "runAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claimedAt" TIMESTAMP(3),
    "failure" TEXT,
    "frames" JSONB,
    "frameCount" INTEGER NOT NULL DEFAULT 0,
    "readings" JSONB,
    "hairMaps" JSONB,
    "selectedFrame" INTEGER NOT NULL DEFAULT 0,
    "proAnswers" JSONB,
    "reviewedAnalysis" JSONB,
    "reviewedByUserId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LookMediaAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LookMediaAnalysisReview" (
    "id" TEXT NOT NULL,
    "analysisId" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "actorRole" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LookMediaAnalysisReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LookMediaAnalysisCall" (
    "id" TEXT NOT NULL,
    "analysisId" TEXT NOT NULL,
    "measurement" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LookMediaAnalysisCall_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LookMediaAnalysis_status_runAt_idx" ON "LookMediaAnalysis"("status", "runAt");

-- CreateIndex
CREATE UNIQUE INDEX "LookMediaAnalysis_mediaAssetId_sourceHash_promptVersion_key" ON "LookMediaAnalysis"("mediaAssetId", "sourceHash", "promptVersion");

-- CreateIndex
CREATE UNIQUE INDEX "LookMediaAnalysisReview_analysisId_revision_key" ON "LookMediaAnalysisReview"("analysisId", "revision");

-- CreateIndex
CREATE INDEX "LookMediaAnalysisCall_analysisId_idx" ON "LookMediaAnalysisCall"("analysisId");

-- AddForeignKey
ALTER TABLE "LookMediaAnalysis" ADD CONSTRAINT "LookMediaAnalysis_mediaAssetId_fkey" FOREIGN KEY ("mediaAssetId") REFERENCES "MediaAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LookMediaAnalysisReview" ADD CONSTRAINT "LookMediaAnalysisReview_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "LookMediaAnalysis"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LookMediaAnalysisCall" ADD CONSTRAINT "LookMediaAnalysisCall_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "LookMediaAnalysis"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Bounded review state; byte snapshots stay private and cascade with the media.
ALTER TABLE "LookMediaAnalysis" ADD CONSTRAINT "LookMediaAnalysis_bounds" CHECK (
  revision >= 0 AND "attemptCount" >= 0 AND "frameCount" BETWEEN 0 AND 3
  AND "selectedFrame" BETWEEN 0 AND 2
  AND (frames IS NULL OR (jsonb_typeof(frames) = 'array' AND jsonb_array_length(frames) = "frameCount" AND octet_length(frames::text) <= 8101000))
  AND (status <> 'READY' OR (frames IS NOT NULL AND readings IS NOT NULL AND "selectedFrame" < "frameCount"))
);
ALTER TABLE "LookMediaAnalysisReview" ADD CONSTRAINT "LookMediaAnalysisReview_action" CHECK (
  "actorRole" IN ('ADMIN', 'PRO') AND action IN ('answer', 'approve', 'reject', 'retry') AND revision > 0
);
CREATE FUNCTION look_media_review_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Look analysis review history is immutable' USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER look_media_review_immutable BEFORE UPDATE ON "LookMediaAnalysisReview"
FOR EACH ROW EXECUTE FUNCTION look_media_review_immutable();
