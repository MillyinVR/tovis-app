-- CreateEnum
CREATE TYPE "NotificationRecipientKind" AS ENUM ('PRO', 'CLIENT');

-- CreateEnum
CREATE TYPE "NotificationEventKey" AS ENUM ('BOOKING_REQUEST_CREATED', 'BOOKING_CONFIRMED', 'BOOKING_RESCHEDULED', 'BOOKING_CANCELLED_BY_CLIENT', 'BOOKING_CANCELLED_BY_PRO', 'BOOKING_CANCELLED_BY_ADMIN', 'CONSULTATION_APPROVED', 'CONSULTATION_REJECTED', 'REVIEW_RECEIVED', 'APPOINTMENT_REMINDER', 'AFTERCARE_READY', 'PAYMENT_COLLECTED', 'PAYMENT_ACTION_REQUIRED');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('IN_APP', 'SMS', 'EMAIL');

-- CreateEnum
CREATE TYPE "NotificationProvider" AS ENUM ('INTERNAL_REALTIME', 'TWILIO', 'POSTMARK');

-- CreateEnum
CREATE TYPE "NotificationDeliveryStatus" AS ENUM ('PENDING', 'PROCESSING', 'SENT', 'DELIVERED', 'FAILED_RETRYABLE', 'FAILED_FINAL', 'SUPPRESSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "NotificationDeliveryEventType" AS ENUM ('CREATED', 'CLAIMED', 'SEND_STARTED', 'PROVIDER_ACCEPTED', 'DELIVERED', 'RETRY_SCHEDULED', 'SUPPRESSED', 'FAILED', 'CANCELLED', 'WEBHOOK_UPDATE');

-- CreateTable
CREATE TABLE "NotificationDispatch" (
    "id" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "eventKey" "NotificationEventKey" NOT NULL,
    "recipientKind" "NotificationRecipientKind" NOT NULL,
    "priority" "NotificationPriority" NOT NULL DEFAULT 'NORMAL',
    "userId" TEXT,
    "professionalId" TEXT,
    "clientId" TEXT,
    "notificationId" TEXT,
    "clientNotificationId" TEXT,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL DEFAULT '',
    "href" TEXT NOT NULL DEFAULT '',
    "payload" JSONB,
    "scheduledFor" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationDispatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationDelivery" (
    "id" TEXT NOT NULL,
    "dispatchId" TEXT NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "provider" "NotificationProvider" NOT NULL,
    "status" "NotificationDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "destination" TEXT,
    "templateKey" TEXT NOT NULL,
    "templateVersion" INTEGER NOT NULL DEFAULT 1,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastAttemptAt" TIMESTAMP(3),
    "claimedAt" TIMESTAMP(3),
    "leaseExpiresAt" TIMESTAMP(3),
    "leaseToken" TEXT,
    "providerMessageId" TEXT,
    "providerStatus" TEXT,
    "lastErrorCode" TEXT,
    "lastErrorMessage" TEXT,
    "sentAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "suppressedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationDeliveryEvent" (
    "id" TEXT NOT NULL,
    "deliveryId" TEXT NOT NULL,
    "attemptNumber" INTEGER,
    "type" "NotificationDeliveryEventType" NOT NULL,
    "fromStatus" "NotificationDeliveryStatus",
    "toStatus" "NotificationDeliveryStatus",
    "providerStatus" TEXT,
    "providerMessageId" TEXT,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "message" TEXT,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationDeliveryEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProfessionalNotificationPreference" (
    "id" TEXT NOT NULL,
    "professionalId" TEXT NOT NULL,
    "eventKey" "NotificationEventKey" NOT NULL,
    "inAppEnabled" BOOLEAN NOT NULL DEFAULT true,
    "smsEnabled" BOOLEAN NOT NULL DEFAULT false,
    "emailEnabled" BOOLEAN NOT NULL DEFAULT true,
    "quietHoursStartMinutes" INTEGER,
    "quietHoursEndMinutes" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProfessionalNotificationPreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientNotificationPreference" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "eventKey" "NotificationEventKey" NOT NULL,
    "inAppEnabled" BOOLEAN NOT NULL DEFAULT true,
    "smsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "emailEnabled" BOOLEAN NOT NULL DEFAULT true,
    "quietHoursStartMinutes" INTEGER,
    "quietHoursEndMinutes" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientNotificationPreference_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "NotificationDispatch_sourceKey_key" ON "NotificationDispatch"("sourceKey");

-- CreateIndex
CREATE INDEX "NotificationDispatch_recipientKind_scheduledFor_createdAt_idx" ON "NotificationDispatch"("recipientKind", "scheduledFor", "createdAt");

-- CreateIndex
CREATE INDEX "NotificationDispatch_professionalId_createdAt_idx" ON "NotificationDispatch"("professionalId", "createdAt");

-- CreateIndex
CREATE INDEX "NotificationDispatch_clientId_createdAt_idx" ON "NotificationDispatch"("clientId", "createdAt");

-- CreateIndex
CREATE INDEX "NotificationDispatch_userId_createdAt_idx" ON "NotificationDispatch"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "NotificationDispatch_notificationId_idx" ON "NotificationDispatch"("notificationId");

-- CreateIndex
CREATE INDEX "NotificationDispatch_clientNotificationId_idx" ON "NotificationDispatch"("clientNotificationId");

-- CreateIndex
CREATE INDEX "NotificationDelivery_status_nextAttemptAt_idx" ON "NotificationDelivery"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "NotificationDelivery_leaseExpiresAt_idx" ON "NotificationDelivery"("leaseExpiresAt");

-- CreateIndex
CREATE INDEX "NotificationDelivery_provider_providerMessageId_idx" ON "NotificationDelivery"("provider", "providerMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationDelivery_dispatchId_channel_key" ON "NotificationDelivery"("dispatchId", "channel");

-- CreateIndex
CREATE INDEX "NotificationDeliveryEvent_deliveryId_createdAt_idx" ON "NotificationDeliveryEvent"("deliveryId", "createdAt");

-- CreateIndex
CREATE INDEX "NotificationDeliveryEvent_type_createdAt_idx" ON "NotificationDeliveryEvent"("type", "createdAt");

-- CreateIndex
CREATE INDEX "ProfessionalNotificationPreference_professionalId_updatedAt_idx" ON "ProfessionalNotificationPreference"("professionalId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProfessionalNotificationPreference_professionalId_eventKey_key" ON "ProfessionalNotificationPreference"("professionalId", "eventKey");

-- CreateIndex
CREATE INDEX "ClientNotificationPreference_clientId_updatedAt_idx" ON "ClientNotificationPreference"("clientId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ClientNotificationPreference_clientId_eventKey_key" ON "ClientNotificationPreference"("clientId", "eventKey");

-- AddForeignKey
ALTER TABLE "NotificationDispatch" ADD CONSTRAINT "NotificationDispatch_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationDispatch" ADD CONSTRAINT "NotificationDispatch_professionalId_fkey" FOREIGN KEY ("professionalId") REFERENCES "ProfessionalProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationDispatch" ADD CONSTRAINT "NotificationDispatch_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "ClientProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationDispatch" ADD CONSTRAINT "NotificationDispatch_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "Notification"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationDispatch" ADD CONSTRAINT "NotificationDispatch_clientNotificationId_fkey" FOREIGN KEY ("clientNotificationId") REFERENCES "ClientNotification"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationDelivery" ADD CONSTRAINT "NotificationDelivery_dispatchId_fkey" FOREIGN KEY ("dispatchId") REFERENCES "NotificationDispatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationDeliveryEvent" ADD CONSTRAINT "NotificationDeliveryEvent_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "NotificationDelivery"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfessionalNotificationPreference" ADD CONSTRAINT "ProfessionalNotificationPreference_professionalId_fkey" FOREIGN KEY ("professionalId") REFERENCES "ProfessionalProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientNotificationPreference" ADD CONSTRAINT "ClientNotificationPreference_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "ClientProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
