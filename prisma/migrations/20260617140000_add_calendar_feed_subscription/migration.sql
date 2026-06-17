-- CreateEnum
CREATE TYPE "CalendarFeedStatus" AS ENUM ('ACTIVE', 'PAUSED', 'ERROR');

-- CreateTable
CREATE TABLE "CalendarFeedSubscription" (
    "id" TEXT NOT NULL,
    "professionalId" TEXT NOT NULL,
    "feedUrl" TEXT NOT NULL,
    "status" "CalendarFeedStatus" NOT NULL DEFAULT 'ACTIVE',
    "lastSyncedAt" TIMESTAMP(3),
    "lastSyncError" TEXT,
    "lastSyncCounts" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CalendarFeedSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CalendarFeedSubscription_professionalId_key" ON "CalendarFeedSubscription"("professionalId");

-- CreateIndex
CREATE INDEX "CalendarFeedSubscription_status_lastSyncedAt_idx" ON "CalendarFeedSubscription"("status", "lastSyncedAt");

-- AddForeignKey
ALTER TABLE "CalendarFeedSubscription" ADD CONSTRAINT "CalendarFeedSubscription_professionalId_fkey" FOREIGN KEY ("professionalId") REFERENCES "ProfessionalProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

