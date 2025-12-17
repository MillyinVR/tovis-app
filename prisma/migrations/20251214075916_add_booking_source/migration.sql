-- CreateEnum
CREATE TYPE "BookingSource" AS ENUM ('REQUESTED', 'DISCOVERY', 'AFTERCARE');

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "rebookOfBookingId" TEXT,
ADD COLUMN     "source" "BookingSource" NOT NULL DEFAULT 'DISCOVERY';

-- CreateIndex
CREATE INDEX "Booking_professionalId_scheduledFor_idx" ON "Booking"("professionalId", "scheduledFor");

-- CreateIndex
CREATE INDEX "Booking_professionalId_clientId_idx" ON "Booking"("professionalId", "clientId");

-- CreateIndex
CREATE INDEX "Booking_professionalId_source_idx" ON "Booking"("professionalId", "source");

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_rebookOfBookingId_fkey" FOREIGN KEY ("rebookOfBookingId") REFERENCES "Booking"("id") ON DELETE SET NULL ON UPDATE CASCADE;
