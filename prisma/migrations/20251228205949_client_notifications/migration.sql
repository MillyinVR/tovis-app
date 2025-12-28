-- CreateEnum
CREATE TYPE "ClientNotificationType" AS ENUM ('AFTERCARE', 'LAST_MINUTE');

-- AlterTable
ALTER TABLE "ClientNotificationSettings" ADD COLUMN     "aftercareEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "maxAftercarePerDay" INTEGER NOT NULL DEFAULT 5;

-- CreateTable
CREATE TABLE "ClientNotification" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "type" "ClientNotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "bookingId" TEXT,
    "aftercareId" TEXT,
    "dedupeKey" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientNotification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ClientNotification_dedupeKey_key" ON "ClientNotification"("dedupeKey");

-- CreateIndex
CREATE INDEX "ClientNotification_clientId_createdAt_idx" ON "ClientNotification"("clientId", "createdAt");

-- CreateIndex
CREATE INDEX "ClientNotification_clientId_readAt_idx" ON "ClientNotification"("clientId", "readAt");

-- AddForeignKey
ALTER TABLE "ClientNotification" ADD CONSTRAINT "ClientNotification_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "ClientProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientNotification" ADD CONSTRAINT "ClientNotification_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientNotification" ADD CONSTRAINT "ClientNotification_aftercareId_fkey" FOREIGN KEY ("aftercareId") REFERENCES "AftercareSummary"("id") ON DELETE SET NULL ON UPDATE CASCADE;
