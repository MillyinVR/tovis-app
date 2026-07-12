-- Creator-page cover banner for the pro profile redesign (§18). A pro can pick
-- one of their own portfolio photos to show as the profile's cover; when unset,
-- the profile renders a graceful branded fallback (never the stretched avatar).
-- Additive + nullable → back-compat (every existing profile stays cover-less =
-- branded fallback, the pre-feature look). Soft link to MediaAsset with
-- ON DELETE SET NULL so deleting the underlying photo simply clears the cover.

-- AlterTable
ALTER TABLE "ProfessionalProfile" ADD COLUMN     "coverMediaAssetId" TEXT;

-- CreateIndex
CREATE INDEX "ProfessionalProfile_coverMediaAssetId_idx" ON "ProfessionalProfile"("coverMediaAssetId");

-- AddForeignKey
ALTER TABLE "ProfessionalProfile" ADD CONSTRAINT "ProfessionalProfile_coverMediaAssetId_fkey" FOREIGN KEY ("coverMediaAssetId") REFERENCES "MediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;
