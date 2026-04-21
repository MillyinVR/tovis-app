-- CreateEnum
CREATE TYPE "ViralRequestApprovalFanOutStatus" AS ENUM ('PLANNED', 'NOTIFICATION_ENQUEUED', 'SKIPPED', 'FAILED');

-- CreateTable
CREATE TABLE "ViralRequestApprovalFanOut" (
    "id" TEXT NOT NULL,
    "viralServiceRequestId" TEXT NOT NULL,
    "professionalId" TEXT NOT NULL,
    "status" "ViralRequestApprovalFanOutStatus" NOT NULL DEFAULT 'PLANNED',
    "matchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "queuedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "skippedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "skipReason" TEXT,
    "lastError" TEXT,
    "notificationId" TEXT,
    "notificationDispatchId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ViralRequestApprovalFanOut_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ViralRequestApprovalFanOut_viralServiceRequestId_status_cre_idx" ON "ViralRequestApprovalFanOut"("viralServiceRequestId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "ViralRequestApprovalFanOut_professionalId_status_createdAt_idx" ON "ViralRequestApprovalFanOut"("professionalId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "ViralRequestApprovalFanOut_notificationId_idx" ON "ViralRequestApprovalFanOut"("notificationId");

-- CreateIndex
CREATE INDEX "ViralRequestApprovalFanOut_notificationDispatchId_idx" ON "ViralRequestApprovalFanOut"("notificationDispatchId");

-- CreateIndex
CREATE UNIQUE INDEX "ViralRequestApprovalFanOut_viralServiceRequestId_profession_key" ON "ViralRequestApprovalFanOut"("viralServiceRequestId", "professionalId");

-- AddForeignKey
ALTER TABLE "ViralRequestApprovalFanOut" ADD CONSTRAINT "ViralRequestApprovalFanOut_viralServiceRequestId_fkey" FOREIGN KEY ("viralServiceRequestId") REFERENCES "ViralServiceRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ViralRequestApprovalFanOut" ADD CONSTRAINT "ViralRequestApprovalFanOut_professionalId_fkey" FOREIGN KEY ("professionalId") REFERENCES "ProfessionalProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ViralRequestApprovalFanOut" ADD CONSTRAINT "ViralRequestApprovalFanOut_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "Notification"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ViralRequestApprovalFanOut" ADD CONSTRAINT "ViralRequestApprovalFanOut_notificationDispatchId_fkey" FOREIGN KEY ("notificationDispatchId") REFERENCES "NotificationDispatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
