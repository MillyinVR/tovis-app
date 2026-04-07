/*
  Warnings:

  - A unique constraint covering the columns `[clientId,dedupeKey]` on the table `ClientNotification` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ClientNotificationType" ADD VALUE 'CONSULTATION_PROPOSAL';
ALTER TYPE "ClientNotificationType" ADD VALUE 'APPOINTMENT_REMINDER';

-- DropForeignKey
ALTER TABLE "ClientNotification" DROP CONSTRAINT "ClientNotification_clientId_fkey";

-- DropIndex
DROP INDEX "ClientNotification_dedupeKey_key";

-- AlterTable
ALTER TABLE "ClientNotification" ADD COLUMN     "data" JSONB,
ADD COLUMN     "href" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateTable
CREATE TABLE "ScheduledClientNotification" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "bookingId" TEXT,
    "type" "ClientNotificationType" NOT NULL,
    "runAt" TIMESTAMP(3) NOT NULL,
    "href" TEXT NOT NULL DEFAULT '',
    "data" JSONB,
    "dedupeKey" TEXT,
    "processedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScheduledClientNotification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ScheduledClientNotification_processedAt_cancelledAt_runAt_idx" ON "ScheduledClientNotification"("processedAt", "cancelledAt", "runAt");

-- CreateIndex
CREATE INDEX "ScheduledClientNotification_clientId_runAt_idx" ON "ScheduledClientNotification"("clientId", "runAt");

-- CreateIndex
CREATE INDEX "ScheduledClientNotification_bookingId_runAt_idx" ON "ScheduledClientNotification"("bookingId", "runAt");

-- CreateIndex
CREATE UNIQUE INDEX "ScheduledClientNotification_clientId_dedupeKey_key" ON "ScheduledClientNotification"("clientId", "dedupeKey");

-- CreateIndex
CREATE INDEX "ClientNotification_clientId_type_createdAt_idx" ON "ClientNotification"("clientId", "type", "createdAt");

-- CreateIndex
CREATE INDEX "ClientNotification_bookingId_idx" ON "ClientNotification"("bookingId");

-- CreateIndex
CREATE INDEX "ClientNotification_aftercareId_idx" ON "ClientNotification"("aftercareId");

-- CreateIndex
CREATE UNIQUE INDEX "ClientNotification_clientId_dedupeKey_key" ON "ClientNotification"("clientId", "dedupeKey");

-- AddForeignKey
ALTER TABLE "ClientNotification" ADD CONSTRAINT "ClientNotification_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "ClientProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduledClientNotification" ADD CONSTRAINT "ScheduledClientNotification_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "ClientProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduledClientNotification" ADD CONSTRAINT "ScheduledClientNotification_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE SET NULL ON UPDATE CASCADE;
