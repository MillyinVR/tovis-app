-- Add ClientProfile.createdByProfessionalId — a soft reference (like
-- photoReleaseByProfessionalId) to the pro who created the client record via
-- upsertProClient (bare directory add or migration import). This is what lets the
-- pro directory surface a booking-less client to its creator and authorize a
-- pro-facing claim invite. Indexed for the directory's OR-visibility filter.

-- AlterTable
ALTER TABLE "ClientProfile" ADD COLUMN "createdByProfessionalId" TEXT;

-- CreateIndex
CREATE INDEX "ClientProfile_createdByProfessionalId_idx" ON "ClientProfile"("createdByProfessionalId");
