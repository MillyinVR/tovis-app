/*
  Warnings:

  - A unique constraint covering the columns `[handleNormalized]` on the table `ProfessionalProfile` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "ProfessionalProfile" ADD COLUMN     "handle" TEXT,
ADD COLUMN     "handleNormalized" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "ProfessionalProfile_handleNormalized_key" ON "ProfessionalProfile"("handleNormalized");

-- CreateIndex
CREATE INDEX "ProfessionalProfile_handleNormalized_idx" ON "ProfessionalProfile"("handleNormalized");
