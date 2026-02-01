/*
  Warnings:

  - You are about to drop the column `locationTimeZone` on the `LastMinuteOpening` table. All the data in the column will be lost.
  - Added the required column `locationType` to the `LastMinuteOpening` table without a default value. This is not possible if the table is not empty.
  - Added the required column `timeZone` to the `LastMinuteOpening` table without a default value. This is not possible if the table is not empty.
  - Made the column `locationId` on table `LastMinuteOpening` required. This step will fail if there are existing NULL values in that column.

*/
-- DropForeignKey
ALTER TABLE "LastMinuteOpening" DROP CONSTRAINT "LastMinuteOpening_locationId_fkey";

-- DropIndex
DROP INDEX "LastMinuteOpening_locationId_startAt_idx";

-- AlterTable
ALTER TABLE "LastMinuteOpening" DROP COLUMN "locationTimeZone",
ADD COLUMN     "locationType" "ServiceLocationType" NOT NULL,
ADD COLUMN     "timeZone" TEXT NOT NULL,
ALTER COLUMN "locationId" SET NOT NULL;

-- CreateIndex
CREATE INDEX "LastMinuteOpening_professionalId_locationId_startAt_idx" ON "LastMinuteOpening"("professionalId", "locationId", "startAt");

-- AddForeignKey
ALTER TABLE "LastMinuteOpening" ADD CONSTRAINT "LastMinuteOpening_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "ProfessionalLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
