/*
  Warnings:

  - You are about to drop the column `workingHoursJson` on the `ProfessionalProfile` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "ProfessionalProfile" DROP COLUMN "workingHoursJson",
ADD COLUMN     "workingHours" JSONB;
