/*
  Warnings:

  - You are about to drop the column `discountPct` on the `LastMinuteOpening` table. All the data in the column will be lost.
  - You are about to drop the column `offeringId` on the `LastMinuteOpening` table. All the data in the column will be lost.
  - You are about to drop the column `serviceId` on the `LastMinuteOpening` table. All the data in the column will be lost.
  - You are about to drop the column `minPrice` on the `LastMinuteServiceRule` table. All the data in the column will be lost.
  - You are about to drop the column `discountsEnabled` on the `LastMinuteSettings` table. All the data in the column will be lost.
  - You are about to drop the column `minPrice` on the `LastMinuteSettings` table. All the data in the column will be lost.
  - You are about to drop the column `window24hPct` on the `LastMinuteSettings` table. All the data in the column will be lost.
  - You are about to drop the column `windowSameDayPct` on the `LastMinuteSettings` table. All the data in the column will be lost.
  - You are about to drop the `OpeningNotification` table. If the table is not empty, all the data it contains will be lost.
  - A unique constraint covering the columns `[lastMinuteOpeningId]` on the table `Booking` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "LastMinuteTier" AS ENUM ('WAITLIST', 'REACTIVATION', 'DISCOVERY');

-- CreateEnum
CREATE TYPE "LastMinuteOfferType" AS ENUM ('NONE', 'PERCENT_OFF', 'AMOUNT_OFF', 'FREE_SERVICE', 'FREE_ADD_ON');

-- CreateEnum
CREATE TYPE "LastMinuteRecipientStatus" AS ENUM ('PLANNED', 'ENQUEUED', 'OPENED', 'CLICKED', 'BOOKED', 'SUPPRESSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "LastMinuteVisibilityMode" AS ENUM ('TARGETED_ONLY', 'PUBLIC_AT_DISCOVERY', 'PUBLIC_IMMEDIATE');

-- DropForeignKey
ALTER TABLE "LastMinuteOpening" DROP CONSTRAINT "LastMinuteOpening_offeringId_fkey";

-- DropForeignKey
ALTER TABLE "LastMinuteOpening" DROP CONSTRAINT "LastMinuteOpening_serviceId_fkey";

-- DropForeignKey
ALTER TABLE "OpeningNotification" DROP CONSTRAINT "OpeningNotification_clientId_fkey";

-- DropForeignKey
ALTER TABLE "OpeningNotification" DROP CONSTRAINT "OpeningNotification_openingId_fkey";

-- DropIndex
DROP INDEX "LastMinuteOpening_serviceId_startAt_idx";

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "lastMinuteOpeningId" TEXT;

-- AlterTable
ALTER TABLE "ClientAddress" ADD COLUMN     "radiusMiles" INTEGER;

-- AlterTable
ALTER TABLE "LastMinuteOpening" DROP COLUMN "discountPct",
DROP COLUMN "offeringId",
DROP COLUMN "serviceId",
ADD COLUMN     "bookedAt" TIMESTAMP(3),
ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "expiresAt" TIMESTAMP(3),
ADD COLUMN     "launchAt" TIMESTAMP(3),
ADD COLUMN     "publicVisibleFrom" TIMESTAMP(3),
ADD COLUMN     "publicVisibleUntil" TIMESTAMP(3),
ADD COLUMN     "visibilityMode" "LastMinuteVisibilityMode" NOT NULL DEFAULT 'PUBLIC_AT_DISCOVERY';

-- AlterTable
ALTER TABLE "LastMinuteServiceRule" DROP COLUMN "minPrice",
ADD COLUMN     "minCollectedSubtotal" DECIMAL(10,2);

-- AlterTable
ALTER TABLE "LastMinuteSettings" DROP COLUMN "discountsEnabled",
DROP COLUMN "minPrice",
DROP COLUMN "window24hPct",
DROP COLUMN "windowSameDayPct",
ADD COLUMN     "defaultVisibilityMode" "LastMinuteVisibilityMode" NOT NULL DEFAULT 'PUBLIC_AT_DISCOVERY',
ADD COLUMN     "minCollectedSubtotal" DECIMAL(10,2),
ADD COLUMN     "tier2NightBeforeMinutes" INTEGER NOT NULL DEFAULT 1140,
ADD COLUMN     "tier3DayOfMinutes" INTEGER NOT NULL DEFAULT 540;

-- DropTable
DROP TABLE "OpeningNotification";

-- DropEnum
DROP TYPE "OpeningTier";

-- CreateTable
CREATE TABLE "LastMinuteOpeningService" (
    "id" TEXT NOT NULL,
    "openingId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "offeringId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LastMinuteOpeningService_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LastMinuteTierPlan" (
    "id" TEXT NOT NULL,
    "openingId" TEXT NOT NULL,
    "tier" "LastMinuteTier" NOT NULL,
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "processedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "lastError" TEXT,
    "offerType" "LastMinuteOfferType" NOT NULL DEFAULT 'NONE',
    "percentOff" INTEGER,
    "amountOff" DECIMAL(10,2),
    "freeAddOnServiceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LastMinuteTierPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LastMinuteRecipient" (
    "id" TEXT NOT NULL,
    "openingId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "firstMatchedTier" "LastMinuteTier" NOT NULL,
    "notifiedTier" "LastMinuteTier",
    "status" "LastMinuteRecipientStatus" NOT NULL DEFAULT 'PLANNED',
    "matchedContext" JSONB,
    "sourceDispatchKey" TEXT,
    "notifiedAt" TIMESTAMP(3),
    "openedAt" TIMESTAMP(3),
    "clickedAt" TIMESTAMP(3),
    "bookedAt" TIMESTAMP(3),
    "suppressedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LastMinuteRecipient_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LastMinuteOpeningService_openingId_sortOrder_idx" ON "LastMinuteOpeningService"("openingId", "sortOrder");

-- CreateIndex
CREATE INDEX "LastMinuteOpeningService_serviceId_idx" ON "LastMinuteOpeningService"("serviceId");

-- CreateIndex
CREATE UNIQUE INDEX "LastMinuteOpeningService_openingId_offeringId_key" ON "LastMinuteOpeningService"("openingId", "offeringId");

-- CreateIndex
CREATE INDEX "LastMinuteTierPlan_scheduledFor_processedAt_cancelledAt_idx" ON "LastMinuteTierPlan"("scheduledFor", "processedAt", "cancelledAt");

-- CreateIndex
CREATE UNIQUE INDEX "LastMinuteTierPlan_openingId_tier_key" ON "LastMinuteTierPlan"("openingId", "tier");

-- CreateIndex
CREATE INDEX "LastMinuteRecipient_clientId_status_createdAt_idx" ON "LastMinuteRecipient"("clientId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "LastMinuteRecipient_openingId_firstMatchedTier_status_idx" ON "LastMinuteRecipient"("openingId", "firstMatchedTier", "status");

-- CreateIndex
CREATE INDEX "LastMinuteRecipient_openingId_notifiedTier_idx" ON "LastMinuteRecipient"("openingId", "notifiedTier");

-- CreateIndex
CREATE UNIQUE INDEX "LastMinuteRecipient_openingId_clientId_key" ON "LastMinuteRecipient"("openingId", "clientId");

-- CreateIndex
CREATE UNIQUE INDEX "Booking_lastMinuteOpeningId_key" ON "Booking"("lastMinuteOpeningId");

-- CreateIndex
CREATE INDEX "LastMinuteOpening_visibilityMode_publicVisibleFrom_status_s_idx" ON "LastMinuteOpening"("visibilityMode", "publicVisibleFrom", "status", "startAt");

-- AddForeignKey
ALTER TABLE "LastMinuteOpeningService" ADD CONSTRAINT "LastMinuteOpeningService_openingId_fkey" FOREIGN KEY ("openingId") REFERENCES "LastMinuteOpening"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LastMinuteOpeningService" ADD CONSTRAINT "LastMinuteOpeningService_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LastMinuteOpeningService" ADD CONSTRAINT "LastMinuteOpeningService_offeringId_fkey" FOREIGN KEY ("offeringId") REFERENCES "ProfessionalServiceOffering"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LastMinuteTierPlan" ADD CONSTRAINT "LastMinuteTierPlan_freeAddOnServiceId_fkey" FOREIGN KEY ("freeAddOnServiceId") REFERENCES "Service"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LastMinuteTierPlan" ADD CONSTRAINT "LastMinuteTierPlan_openingId_fkey" FOREIGN KEY ("openingId") REFERENCES "LastMinuteOpening"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LastMinuteRecipient" ADD CONSTRAINT "LastMinuteRecipient_openingId_fkey" FOREIGN KEY ("openingId") REFERENCES "LastMinuteOpening"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LastMinuteRecipient" ADD CONSTRAINT "LastMinuteRecipient_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "ClientProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_lastMinuteOpeningId_fkey" FOREIGN KEY ("lastMinuteOpeningId") REFERENCES "LastMinuteOpening"("id") ON DELETE SET NULL ON UPDATE CASCADE;
