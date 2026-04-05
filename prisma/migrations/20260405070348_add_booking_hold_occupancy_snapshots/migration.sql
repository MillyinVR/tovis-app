-- AlterTable
ALTER TABLE "BookingHold" ADD COLUMN     "bufferMinutesSnapshot" INTEGER,
ADD COLUMN     "durationMinutesSnapshot" INTEGER,
ADD COLUMN     "endsAtSnapshot" TIMESTAMP(3);
