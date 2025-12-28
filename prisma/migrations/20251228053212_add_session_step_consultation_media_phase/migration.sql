-- CreateEnum
CREATE TYPE "SessionStep" AS ENUM ('NONE', 'CONSULTATION_DRAFT', 'AWAITING_CLIENT_APPROVAL', 'BEFORE_PHOTOS', 'READY_TO_FINISH', 'FINISH_DETAILS', 'AFTER_PHOTOS', 'DONE');

-- CreateEnum
CREATE TYPE "MediaPhase" AS ENUM ('BEFORE', 'AFTER', 'OTHER');

-- AlterTable
ALTER TABLE "MediaAsset" ADD COLUMN     "phase" "MediaPhase" NOT NULL DEFAULT 'OTHER';

-- CreateTable
CREATE TABLE "BookingConsultation" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "bookingId" TEXT NOT NULL,
    "proposedServicesJson" JSONB,
    "proposedPrice" DECIMAL(65,30),
    "notes" TEXT,
    "clientApprovedAt" TIMESTAMP(3),
    "clientDeclinedAt" TIMESTAMP(3),
    "clientMessage" TEXT,

    CONSTRAINT "BookingConsultation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BookingConsultation_bookingId_key" ON "BookingConsultation"("bookingId");

-- AddForeignKey
ALTER TABLE "BookingConsultation" ADD CONSTRAINT "BookingConsultation_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;
