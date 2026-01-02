-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "bufferMinutes" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "subtotalSnapshot" DECIMAL(10,2),
ADD COLUMN     "totalDurationMinutes" INTEGER;

-- CreateIndex
CREATE INDEX "BookingServiceItem_bookingId_sortOrder_idx" ON "BookingServiceItem"("bookingId", "sortOrder");
