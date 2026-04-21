-- CreateIndex
CREATE INDEX "LookPost_professionalId_status_updatedAt_idx" ON "LookPost"("professionalId", "status", "updatedAt");

-- CreateIndex
CREATE INDEX "LookPost_professionalId_visibility_updatedAt_idx" ON "LookPost"("professionalId", "visibility", "updatedAt");

-- CreateIndex
CREATE INDEX "MediaAsset_professionalId_createdAt_idx" ON "MediaAsset"("professionalId", "createdAt");

-- CreateIndex
CREATE INDEX "MediaAsset_professionalId_isEligibleForLooks_createdAt_idx" ON "MediaAsset"("professionalId", "isEligibleForLooks", "createdAt");

-- CreateIndex
CREATE INDEX "MediaAsset_professionalId_isFeaturedInPortfolio_createdAt_idx" ON "MediaAsset"("professionalId", "isFeaturedInPortfolio", "createdAt");

-- CreateIndex
CREATE INDEX "MediaAsset_uploadedByUserId_createdAt_idx" ON "MediaAsset"("uploadedByUserId", "createdAt");
