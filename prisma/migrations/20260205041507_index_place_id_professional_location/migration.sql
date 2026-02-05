/*
  Warnings:

  - You are about to alter the column `lat` on the `ProfessionalLocation` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(10,7)`.
  - You are about to alter the column `lng` on the `ProfessionalLocation` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(10,7)`.

*/
-- AlterTable
ALTER TABLE "ProfessionalLocation" ALTER COLUMN "lat" SET DATA TYPE DECIMAL(10,7),
ALTER COLUMN "lng" SET DATA TYPE DECIMAL(10,7);

-- CreateIndex
CREATE INDEX "ProfessionalLocation_placeId_idx" ON "ProfessionalLocation"("placeId");
