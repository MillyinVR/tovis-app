-- CreateTable
CREATE TABLE "BookingServiceItem" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "offeringId" TEXT,
    "priceSnapshot" DECIMAL(10,2) NOT NULL,
    "durationMinutesSnapshot" INTEGER NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BookingServiceItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BookingServiceItem_bookingId_idx" ON "BookingServiceItem"("bookingId");

-- CreateIndex
CREATE INDEX "BookingServiceItem_serviceId_idx" ON "BookingServiceItem"("serviceId");

-- AddForeignKey
ALTER TABLE "BookingServiceItem" ADD CONSTRAINT "BookingServiceItem_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingServiceItem" ADD CONSTRAINT "BookingServiceItem_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingServiceItem" ADD CONSTRAINT "BookingServiceItem_offeringId_fkey" FOREIGN KEY ("offeringId") REFERENCES "ProfessionalServiceOffering"("id") ON DELETE SET NULL ON UPDATE CASCADE;
