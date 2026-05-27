/*
  Warnings:

  - Made the column `email` on table `User` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "BookingCloseoutAuditAction" ADD VALUE 'BEFORE_PHOTO_UPLOADED';
ALTER TYPE "BookingCloseoutAuditAction" ADD VALUE 'AFTER_PHOTO_UPLOADED';

-- DropIndex
DROP INDEX "ProClientInvite_token_idx";

-- DropIndex
DROP INDEX "ProfessionalSearchIndex_categoryIds_gin_idx";

-- DropIndex
DROP INDEX "ProfessionalSearchIndex_geom_gist_idx";

-- DropIndex
DROP INDEX "ProfessionalSearchIndex_serviceIds_gin_idx";

-- AlterTable
ALTER TABLE "ProClientInvite" ALTER COLUMN "token" DROP NOT NULL;

-- AlterTable
ALTER TABLE "ProfessionalSearchIndex" ALTER COLUMN "categoryIds" DROP DEFAULT,
ALTER COLUMN "serviceIds" DROP DEFAULT;

-- AlterTable
ALTER TABLE "User" ALTER COLUMN "email" SET NOT NULL;

-- RenameIndex
ALTER INDEX "ProfessionalSearchIndex_verification_bookable_idx" RENAME TO "ProfessionalSearchIndex_verificationStatus_isBookable_idx";
