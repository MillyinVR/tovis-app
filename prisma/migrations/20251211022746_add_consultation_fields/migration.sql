-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "consultationConfirmedAt" TIMESTAMP(3),
ADD COLUMN     "consultationNotes" TEXT,
ADD COLUMN     "consultationPriceCents" INTEGER;
