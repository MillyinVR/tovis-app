/*
  Warnings:

  - Made the column `reason` on table `Notification` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ProNotificationReason" ADD VALUE 'PAYMENT_COLLECTED';
ALTER TYPE "ProNotificationReason" ADD VALUE 'PAYMENT_ACTION_REQUIRED';

-- DropIndex
DROP INDEX "Notification_professionalId_createdAt_idx";

-- DropIndex
DROP INDEX "Notification_professionalId_readAt_idx";

-- DropIndex
DROP INDEX "Notification_professionalId_reason_createdAt_idx";

-- DropIndex
DROP INDEX "Notification_professionalId_type_createdAt_idx";

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "clickedAt" TIMESTAMP(3),
ADD COLUMN     "seenAt" TIMESTAMP(3),
ALTER COLUMN "reason" SET NOT NULL;

-- CreateIndex
CREATE INDEX "Notification_professionalId_archivedAt_readAt_createdAt_idx" ON "Notification"("professionalId", "archivedAt", "readAt", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_professionalId_type_archivedAt_createdAt_idx" ON "Notification"("professionalId", "type", "archivedAt", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_professionalId_reason_archivedAt_createdAt_idx" ON "Notification"("professionalId", "reason", "archivedAt", "createdAt");
