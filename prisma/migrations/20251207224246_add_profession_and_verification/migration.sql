-- CreateEnum
CREATE TYPE "ProfessionType" AS ENUM ('COSMETOLOGIST', 'BARBER', 'ESTHETICIAN', 'MANICURIST', 'MASSAGE_THERAPIST', 'MAKEUP_ARTIST');

-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "VerificationDocumentType" AS ENUM ('LICENSE', 'ID_CARD', 'MAKEUP_PRIMARY', 'MAKEUP_SECONDARY');

-- AlterTable
ALTER TABLE "ProfessionalProfile" ADD COLUMN     "licenseExpiry" TIMESTAMP(3),
ADD COLUMN     "licenseState" TEXT,
ADD COLUMN     "professionType" "ProfessionType",
ADD COLUMN     "verificationStatus" "VerificationStatus" NOT NULL DEFAULT 'PENDING';

-- CreateTable
CREATE TABLE "VerificationDocument" (
    "id" TEXT NOT NULL,
    "professionalId" TEXT NOT NULL,
    "type" "VerificationDocumentType" NOT NULL,
    "label" TEXT,
    "imageUrl" TEXT,
    "url" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),
    "status" "VerificationStatus" NOT NULL DEFAULT 'PENDING',
    "adminNote" TEXT,

    CONSTRAINT "VerificationDocument_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "VerificationDocument" ADD CONSTRAINT "VerificationDocument_professionalId_fkey" FOREIGN KEY ("professionalId") REFERENCES "ProfessionalProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
