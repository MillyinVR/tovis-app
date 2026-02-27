/*
  Warnings:

  - You are about to drop the column `mobileRadiusKm` on the `ProfessionalProfile` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "ProfessionalProfile" DROP COLUMN "mobileRadiusKm",
ADD COLUMN     "mobileRadiusMiles" INTEGER;
