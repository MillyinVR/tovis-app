-- Pro-chosen "featured pair" for a client's aftercare summary: which BEFORE and
-- which AFTER photo render as the primary before/after comparison (every other
-- before/after photo shows as a flat thumbnail). Both additive + nullable →
-- back-compat; null falls back to the earliest BEFORE / AFTER (the pre-feature
-- behavior). Aftercare-only + PRO_CLIENT — deliberately NOT the portfolio
-- MediaAsset.beforeAssetId pairing, so featuring here never flips a photo PUBLIC
-- or touches the public-share consent gate. FKs are ON DELETE SET NULL so
-- deleting a photo simply clears the selection.

-- AlterTable
ALTER TABLE "AftercareSummary" ADD COLUMN     "featuredAfterAssetId" TEXT,
ADD COLUMN     "featuredBeforeAssetId" TEXT;

-- CreateIndex
CREATE INDEX "AftercareSummary_featuredBeforeAssetId_idx" ON "AftercareSummary"("featuredBeforeAssetId");

-- CreateIndex
CREATE INDEX "AftercareSummary_featuredAfterAssetId_idx" ON "AftercareSummary"("featuredAfterAssetId");

-- AddForeignKey
ALTER TABLE "AftercareSummary" ADD CONSTRAINT "AftercareSummary_featuredBeforeAssetId_fkey" FOREIGN KEY ("featuredBeforeAssetId") REFERENCES "MediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AftercareSummary" ADD CONSTRAINT "AftercareSummary_featuredAfterAssetId_fkey" FOREIGN KEY ("featuredAfterAssetId") REFERENCES "MediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;
