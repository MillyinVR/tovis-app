-- Public social presence on the pro profile (additive, display-only).
ALTER TABLE "ProfessionalProfile" ADD COLUMN "instagramHandle" TEXT;
ALTER TABLE "ProfessionalProfile" ADD COLUMN "tiktokHandle" TEXT;
ALTER TABLE "ProfessionalProfile" ADD COLUMN "websiteUrl" TEXT;
