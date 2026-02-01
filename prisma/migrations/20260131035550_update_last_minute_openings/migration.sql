-- AlterTable
ALTER TABLE "LastMinuteOpening" ADD COLUMN     "locationId" TEXT,
ADD COLUMN     "locationTimeZone" TEXT;

-- CreateIndex
CREATE INDEX "LastMinuteOpening_locationId_startAt_idx" ON "LastMinuteOpening"("locationId", "startAt");

-- AddForeignKey
ALTER TABLE "LastMinuteOpening" ADD CONSTRAINT "LastMinuteOpening_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "ProfessionalLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
