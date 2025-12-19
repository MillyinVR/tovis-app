-- CreateEnum
CREATE TYPE "ClientIntentType" AS ENUM ('VIEW_PRO', 'VIEW_SERVICE', 'VIEW_OFFERING', 'VIEW_MEDIA');

-- CreateEnum
CREATE TYPE "OpeningTier" AS ENUM ('TIER1_WAITLIST_LAPSED', 'TIER2_FAVORITE_VIEWER', 'TIER3_PUBLIC');

-- CreateEnum
CREATE TYPE "OpeningStatus" AS ENUM ('ACTIVE', 'BOOKED', 'EXPIRED', 'CANCELLED');

-- AlterTable
ALTER TABLE "ProfessionalServiceOffering" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- CreateTable
CREATE TABLE "LastMinuteOpening" (
    "id" TEXT NOT NULL,
    "professionalId" TEXT NOT NULL,
    "serviceId" TEXT,
    "offeringId" TEXT,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3),
    "status" "OpeningStatus" NOT NULL DEFAULT 'ACTIVE',
    "discountPct" INTEGER,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LastMinuteOpening_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpeningNotification" (
    "id" TEXT NOT NULL,
    "openingId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "tier" "OpeningTier" NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveredAt" TIMESTAMP(3),
    "openedAt" TIMESTAMP(3),
    "clickedAt" TIMESTAMP(3),
    "bookedAt" TIMESTAMP(3),
    "dedupeKey" TEXT,

    CONSTRAINT "OpeningNotification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientIntentEvent" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "type" "ClientIntentType" NOT NULL,
    "professionalId" TEXT,
    "serviceId" TEXT,
    "offeringId" TEXT,
    "mediaId" TEXT,
    "source" "BookingSource",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sessionId" TEXT,

    CONSTRAINT "ClientIntentEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientNotificationSettings" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "lastMinuteEnabled" BOOLEAN NOT NULL DEFAULT true,
    "maxLastMinutePerDay" INTEGER NOT NULL DEFAULT 2,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientNotificationSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LastMinuteOpening_professionalId_startAt_idx" ON "LastMinuteOpening"("professionalId", "startAt");

-- CreateIndex
CREATE INDEX "LastMinuteOpening_serviceId_startAt_idx" ON "LastMinuteOpening"("serviceId", "startAt");

-- CreateIndex
CREATE INDEX "LastMinuteOpening_status_startAt_idx" ON "LastMinuteOpening"("status", "startAt");

-- CreateIndex
CREATE UNIQUE INDEX "OpeningNotification_dedupeKey_key" ON "OpeningNotification"("dedupeKey");

-- CreateIndex
CREATE INDEX "OpeningNotification_clientId_sentAt_idx" ON "OpeningNotification"("clientId", "sentAt");

-- CreateIndex
CREATE INDEX "OpeningNotification_openingId_sentAt_idx" ON "OpeningNotification"("openingId", "sentAt");

-- CreateIndex
CREATE UNIQUE INDEX "OpeningNotification_openingId_clientId_tier_key" ON "OpeningNotification"("openingId", "clientId", "tier");

-- CreateIndex
CREATE INDEX "ClientIntentEvent_clientId_createdAt_idx" ON "ClientIntentEvent"("clientId", "createdAt");

-- CreateIndex
CREATE INDEX "ClientIntentEvent_professionalId_createdAt_idx" ON "ClientIntentEvent"("professionalId", "createdAt");

-- CreateIndex
CREATE INDEX "ClientIntentEvent_serviceId_createdAt_idx" ON "ClientIntentEvent"("serviceId", "createdAt");

-- CreateIndex
CREATE INDEX "ClientIntentEvent_offeringId_createdAt_idx" ON "ClientIntentEvent"("offeringId", "createdAt");

-- CreateIndex
CREATE INDEX "ClientIntentEvent_mediaId_createdAt_idx" ON "ClientIntentEvent"("mediaId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ClientNotificationSettings_clientId_key" ON "ClientNotificationSettings"("clientId");

-- AddForeignKey
ALTER TABLE "LastMinuteOpening" ADD CONSTRAINT "LastMinuteOpening_professionalId_fkey" FOREIGN KEY ("professionalId") REFERENCES "ProfessionalProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LastMinuteOpening" ADD CONSTRAINT "LastMinuteOpening_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LastMinuteOpening" ADD CONSTRAINT "LastMinuteOpening_offeringId_fkey" FOREIGN KEY ("offeringId") REFERENCES "ProfessionalServiceOffering"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpeningNotification" ADD CONSTRAINT "OpeningNotification_openingId_fkey" FOREIGN KEY ("openingId") REFERENCES "LastMinuteOpening"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpeningNotification" ADD CONSTRAINT "OpeningNotification_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "ClientProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientIntentEvent" ADD CONSTRAINT "ClientIntentEvent_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "ClientProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientIntentEvent" ADD CONSTRAINT "ClientIntentEvent_professionalId_fkey" FOREIGN KEY ("professionalId") REFERENCES "ProfessionalProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientIntentEvent" ADD CONSTRAINT "ClientIntentEvent_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientIntentEvent" ADD CONSTRAINT "ClientIntentEvent_offeringId_fkey" FOREIGN KEY ("offeringId") REFERENCES "ProfessionalServiceOffering"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientIntentEvent" ADD CONSTRAINT "ClientIntentEvent_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "MediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientNotificationSettings" ADD CONSTRAINT "ClientNotificationSettings_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "ClientProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
