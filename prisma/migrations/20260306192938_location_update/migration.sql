/*
  Warnings:

  - A unique constraint covering the columns `[professionalId,scheduledFor]` on the table `BookingHold` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "BookingHold_locationId_scheduledFor_key";

-- CreateIndex
CREATE INDEX "BookingHold_locationId_scheduledFor_idx" ON "BookingHold"("locationId", "scheduledFor");

-- CreateIndex
CREATE UNIQUE INDEX "BookingHold_professionalId_scheduledFor_key" ON "BookingHold"("professionalId", "scheduledFor");
