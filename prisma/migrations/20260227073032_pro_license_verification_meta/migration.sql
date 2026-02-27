-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ProfessionType" ADD VALUE 'HAIRSTYLIST';
ALTER TYPE "ProfessionType" ADD VALUE 'ELECTROLOGIST';

-- AlterTable
ALTER TABLE "ProfessionalProfile" ADD COLUMN     "licenseRawJson" JSONB,
ADD COLUMN     "licenseStatusCode" TEXT,
ADD COLUMN     "licenseVerifiedAt" TIMESTAMP(3),
ADD COLUMN     "licenseVerifiedSource" TEXT;
