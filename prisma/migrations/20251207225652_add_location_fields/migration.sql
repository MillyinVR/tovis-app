/*
  Warnings:

  - Made the column `location` on table `ProfessionalProfile` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "ProfessionalProfile" ADD COLUMN     "addressLine1" TEXT,
ADD COLUMN     "addressLine2" TEXT,
ADD COLUMN     "city" TEXT,
ADD COLUMN     "latitude" DOUBLE PRECISION,
ADD COLUMN     "longitude" DOUBLE PRECISION,
ADD COLUMN     "mobileRadiusKm" INTEGER,
ADD COLUMN     "postalCode" TEXT,
ADD COLUMN     "state" TEXT,
ALTER COLUMN "location" SET NOT NULL,
ALTER COLUMN "location" SET DEFAULT '';
