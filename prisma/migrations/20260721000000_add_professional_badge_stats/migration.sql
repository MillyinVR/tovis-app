-- Per-pro live-booking aggregates behind the Looks feed badge engine
-- (personalization spec §5). Refreshed hourly by the pro-badge-stats job;
-- a missing row reads the same as all-zero. Additive — safe on a live DB.

-- CreateTable
CREATE TABLE "ProfessionalBadgeStat" (
    "professionalId" TEXT NOT NULL,
    "recentBookingCount" INTEGER NOT NULL DEFAULT 0,
    "completedBookingCount30d" INTEGER NOT NULL DEFAULT 0,
    "servedClientCount" INTEGER NOT NULL DEFAULT 0,
    "rebookedClientCount" INTEGER NOT NULL DEFAULT 0,
    "computedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProfessionalBadgeStat_pkey" PRIMARY KEY ("professionalId")
);

-- AddForeignKey
ALTER TABLE "ProfessionalBadgeStat" ADD CONSTRAINT "ProfessionalBadgeStat_professionalId_fkey" FOREIGN KEY ("professionalId") REFERENCES "ProfessionalProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
