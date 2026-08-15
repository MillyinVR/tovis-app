-- The pro's SIGNATURE post (client walkthrough screen 6). One optional,
-- pro-chosen piece of their own work — "the work they specialize in or what they
-- consider their best work" (Tori, 2026-08-14) — promoted above the portfolio
-- grid on the public profile.
--
-- 🔴 Deliberately NOT "Spotlight" (LookPost.featuredAt = a SUPER_ADMIN editorial
-- pick) and NOT "Featured" (already spoken for by MediaAsset.isFeaturedInPortfolio,
-- LookPost.featuredAt/featuredByUserId and AftercareSummary.featuredBefore/AfterAssetId).
-- A pro-applied choice must not wear a name that claims the platform picked them.
--
-- Same shape as coverMediaAssetId (20260720000000): additive + nullable → every
-- existing profile stays signature-less, which is exactly the pre-feature page.
-- Soft link to MediaAsset with ON DELETE SET NULL so deleting the underlying
-- photo simply clears the choice instead of blocking the delete.

-- AlterTable
ALTER TABLE "ProfessionalProfile" ADD COLUMN     "signatureMediaAssetId" TEXT;

-- CreateIndex
CREATE INDEX "ProfessionalProfile_signatureMediaAssetId_idx" ON "ProfessionalProfile"("signatureMediaAssetId");

-- AddForeignKey
ALTER TABLE "ProfessionalProfile" ADD CONSTRAINT "ProfessionalProfile_signatureMediaAssetId_fkey" FOREIGN KEY ("signatureMediaAssetId") REFERENCES "MediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;
