-- CreateEnum
CREATE TYPE "ProfessionalLocationType" AS ENUM ('SALON', 'SUITE', 'MOBILE_BASE', 'OTHER');

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "clientTimeZoneAtBooking" TEXT,
ADD COLUMN     "locationAddressSnapshot" JSONB,
ADD COLUMN     "locationId" TEXT,
ADD COLUMN     "locationLatSnapshot" DOUBLE PRECISION,
ADD COLUMN     "locationLngSnapshot" DOUBLE PRECISION,
ADD COLUMN     "locationTimeZone" TEXT;

-- AlterTable
ALTER TABLE "BookingHold" ADD COLUMN     "locationAddressSnapshot" JSONB,
ADD COLUMN     "locationId" TEXT,
ADD COLUMN     "locationLatSnapshot" DOUBLE PRECISION,
ADD COLUMN     "locationLngSnapshot" DOUBLE PRECISION,
ADD COLUMN     "locationTimeZone" TEXT;

-- AlterTable
ALTER TABLE "CalendarBlock" ADD COLUMN     "locationId" TEXT;

-- CreateTable
CREATE TABLE "ProfessionalLocation" (
    "id" TEXT NOT NULL,
    "professionalId" TEXT NOT NULL,
    "type" "ProfessionalLocationType" NOT NULL DEFAULT 'SALON',
    "name" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "isBookable" BOOLEAN NOT NULL DEFAULT true,
    "formattedAddress" TEXT,
    "addressLine1" TEXT,
    "addressLine2" TEXT,
    "city" TEXT,
    "state" TEXT,
    "postalCode" TEXT,
    "countryCode" TEXT,
    "placeId" TEXT,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "timeZone" TEXT,
    "workingHours" JSONB,
    "bufferMinutes" INTEGER,
    "stepMinutes" INTEGER,
    "advanceNoticeMinutes" INTEGER,
    "maxDaysAhead" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProfessionalLocation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProfessionalLocation_professionalId_idx" ON "ProfessionalLocation"("professionalId");

-- CreateIndex
CREATE INDEX "ProfessionalLocation_professionalId_isPrimary_idx" ON "ProfessionalLocation"("professionalId", "isPrimary");

-- CreateIndex
CREATE INDEX "ProfessionalLocation_professionalId_isBookable_idx" ON "ProfessionalLocation"("professionalId", "isBookable");

-- CreateIndex
CREATE INDEX "ProfessionalLocation_lat_lng_idx" ON "ProfessionalLocation"("lat", "lng");

-- CreateIndex
CREATE INDEX "Booking_locationId_idx" ON "Booking"("locationId");

-- CreateIndex
CREATE INDEX "Booking_locationTimeZone_idx" ON "Booking"("locationTimeZone");

-- CreateIndex
CREATE INDEX "BookingHold_locationId_idx" ON "BookingHold"("locationId");

-- CreateIndex
CREATE INDEX "BookingHold_locationTimeZone_idx" ON "BookingHold"("locationTimeZone");

-- CreateIndex
CREATE INDEX "CalendarBlock_locationId_idx" ON "CalendarBlock"("locationId");

-- AddForeignKey
ALTER TABLE "ProfessionalLocation" ADD CONSTRAINT "ProfessionalLocation_professionalId_fkey" FOREIGN KEY ("professionalId") REFERENCES "ProfessionalProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "ProfessionalLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingHold" ADD CONSTRAINT "BookingHold_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "ProfessionalLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarBlock" ADD CONSTRAINT "CalendarBlock_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "ProfessionalLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
