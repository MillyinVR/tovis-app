-- Per-LOOK booking-conversion aggregate behind the Looks feed
-- booking_conversion_rate term (personalization spec §4.2). Refreshed hourly by
-- the look-conversion-stats job (lib/looks/conversionStats.ts); only looks with
-- >=1 attributed non-cancelled booking get a row, so a missing row reads as
-- "no conversion signal" (boost 0). Additive — safe on a live DB.

-- CreateTable
CREATE TABLE "LookPostConversionStat" (
    "lookPostId" TEXT NOT NULL,
    "bookingCount" INTEGER NOT NULL DEFAULT 0,
    "interestCount" INTEGER NOT NULL DEFAULT 0,
    "computedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LookPostConversionStat_pkey" PRIMARY KEY ("lookPostId")
);

-- AddForeignKey
ALTER TABLE "LookPostConversionStat" ADD CONSTRAINT "LookPostConversionStat_lookPostId_fkey" FOREIGN KEY ("lookPostId") REFERENCES "LookPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;
