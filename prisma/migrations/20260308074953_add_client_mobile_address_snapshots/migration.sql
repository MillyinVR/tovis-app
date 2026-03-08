-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "clientAddressId" TEXT,
ADD COLUMN     "clientAddressLatSnapshot" DOUBLE PRECISION,
ADD COLUMN     "clientAddressLngSnapshot" DOUBLE PRECISION,
ADD COLUMN     "clientAddressSnapshot" JSONB;

-- AlterTable
ALTER TABLE "BookingHold" ADD COLUMN     "clientAddressId" TEXT,
ADD COLUMN     "clientAddressLatSnapshot" DOUBLE PRECISION,
ADD COLUMN     "clientAddressLngSnapshot" DOUBLE PRECISION,
ADD COLUMN     "clientAddressSnapshot" JSONB;

-- CreateIndex
CREATE INDEX "Booking_clientAddressId_idx" ON "Booking"("clientAddressId");

-- CreateIndex
CREATE INDEX "BookingHold_clientAddressId_idx" ON "BookingHold"("clientAddressId");

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_clientAddressId_fkey" FOREIGN KEY ("clientAddressId") REFERENCES "ClientAddress"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingHold" ADD CONSTRAINT "BookingHold_clientAddressId_fkey" FOREIGN KEY ("clientAddressId") REFERENCES "ClientAddress"("id") ON DELETE SET NULL ON UPDATE CASCADE;
