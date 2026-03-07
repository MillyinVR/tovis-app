/*
  Warnings:

  - A unique constraint covering the columns `[professionalId,scheduledFor]` on the table `Booking` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "Booking_professionalId_scheduledFor_key" ON "Booking"("professionalId", "scheduledFor");
