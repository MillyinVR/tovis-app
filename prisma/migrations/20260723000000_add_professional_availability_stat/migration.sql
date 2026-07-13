-- Per-pro calendar-availability summary behind the Looks feed availability_boost
-- term (personalization spec §4.2/§4.4). Refreshed hourly by the
-- pro-availability-stats job; a missing row reads the same as "no availability
-- signal" (boost 0). Additive — safe on a live DB.

-- CreateTable
CREATE TABLE "ProfessionalAvailabilityStat" (
    "professionalId" TEXT NOT NULL,
    "nextOpeningDate" TIMESTAMP(3),
    "openDayCount14d" INTEGER NOT NULL DEFAULT 0,
    "fullness14d" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "capacityMinutes14d" INTEGER NOT NULL DEFAULT 0,
    "computedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProfessionalAvailabilityStat_pkey" PRIMARY KEY ("professionalId")
);

-- AddForeignKey
ALTER TABLE "ProfessionalAvailabilityStat" ADD CONSTRAINT "ProfessionalAvailabilityStat_professionalId_fkey" FOREIGN KEY ("professionalId") REFERENCES "ProfessionalProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
