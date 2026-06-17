-- AlterEnum
ALTER TYPE "LastMinuteRecipientStatus" ADD VALUE 'PRIORITY_OFFERED';
ALTER TYPE "LastMinuteRecipientStatus" ADD VALUE 'PRIORITY_EXPIRED';
ALTER TYPE "LastMinuteRecipientStatus" ADD VALUE 'PRIORITY_DECLINED';

-- AlterTable
ALTER TABLE "LastMinuteRecipient" ADD COLUMN "priorityExpiresAt" TIMESTAMP(3),
ADD COLUMN "priorityOrder" INTEGER;

-- AlterTable
ALTER TABLE "LastMinuteSettings" ADD COLUMN "priorityOfferEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "priorityOfferMinutes" INTEGER NOT NULL DEFAULT 30;

-- CreateIndex
CREATE INDEX "LastMinuteRecipient_openingId_status_priorityExpiresAt_idx" ON "LastMinuteRecipient"("openingId", "status", "priorityExpiresAt");
