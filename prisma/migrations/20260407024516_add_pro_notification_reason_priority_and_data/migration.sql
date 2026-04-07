-- CreateEnum
CREATE TYPE "NotificationPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "ProNotificationReason" AS ENUM ('BOOKING_REQUEST_CREATED', 'BOOKING_CONFIRMED', 'BOOKING_RESCHEDULED', 'BOOKING_CANCELLED_BY_CLIENT', 'BOOKING_CANCELLED_BY_ADMIN', 'CONSULTATION_APPROVED', 'CONSULTATION_REJECTED', 'REVIEW_RECEIVED');

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "data" JSONB,
ADD COLUMN     "priority" "NotificationPriority" NOT NULL DEFAULT 'NORMAL',
ADD COLUMN     "reason" "ProNotificationReason";

-- CreateIndex
CREATE INDEX "Notification_professionalId_type_createdAt_idx" ON "Notification"("professionalId", "type", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_professionalId_reason_createdAt_idx" ON "Notification"("professionalId", "reason", "createdAt");
