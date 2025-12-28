/*
  Warnings:

  - A unique constraint covering the columns `[professionalId,scheduledFor,locationType]` on the table `BookingHold` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "BookingHold_professionalId_scheduledFor_idx";

-- CreateIndex
CREATE UNIQUE INDEX "BookingHold_professionalId_scheduledFor_locationType_key" ON "BookingHold"("professionalId", "scheduledFor", "locationType");
