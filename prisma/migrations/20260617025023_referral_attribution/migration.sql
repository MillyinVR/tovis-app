-- CreateEnum
CREATE TYPE "ReferralStatus" AS ENUM ('PENDING', 'CONFIRMED', 'CONVERTED', 'REWARDED', 'DECLINED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "ReferralRewardTier" AS ENUM ('RECOGNITION', 'DISCOUNT', 'CREDIT');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationEventKey" ADD VALUE 'REFERRAL_TAP_RECEIVED';
ALTER TYPE "NotificationEventKey" ADD VALUE 'REFERRAL_CONFIRMED';
ALTER TYPE "NotificationEventKey" ADD VALUE 'REFERRAL_CONVERTED';

-- AlterTable
ALTER TABLE "ProfessionalPaymentSettings" ADD COLUMN     "referralCreditAmount" DECIMAL(10,2),
ADD COLUMN     "referralDiscountPercent" INTEGER,
ADD COLUMN     "referralRewardEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "referralRewardTier" "ReferralRewardTier" NOT NULL DEFAULT 'RECOGNITION';

-- CreateTable
CREATE TABLE "Referral" (
    "id" TEXT NOT NULL,
    "referrerClientId" TEXT NOT NULL,
    "referredClientId" TEXT NOT NULL,
    "nfcCardId" TEXT,
    "status" "ReferralStatus" NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "confirmedAt" TIMESTAMP(3),
    "convertedAt" TIMESTAMP(3),
    "triggerBookingId" TEXT,
    "professionalId" TEXT,
    "rewardTier" "ReferralRewardTier",
    "rewardValue" DECIMAL(10,2),
    "rewardAppliedAt" TIMESTAMP(3),
    "rewardBookingId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Referral_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Referral_triggerBookingId_key" ON "Referral"("triggerBookingId");

-- CreateIndex
CREATE UNIQUE INDEX "Referral_rewardBookingId_key" ON "Referral"("rewardBookingId");

-- CreateIndex
CREATE INDEX "Referral_referrerClientId_status_idx" ON "Referral"("referrerClientId", "status");

-- CreateIndex
CREATE INDEX "Referral_referredClientId_status_idx" ON "Referral"("referredClientId", "status");

-- CreateIndex
CREATE INDEX "Referral_professionalId_status_idx" ON "Referral"("professionalId", "status");

-- CreateIndex
CREATE INDEX "Referral_nfcCardId_idx" ON "Referral"("nfcCardId");

-- AddForeignKey
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_referrerClientId_fkey" FOREIGN KEY ("referrerClientId") REFERENCES "ClientProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_referredClientId_fkey" FOREIGN KEY ("referredClientId") REFERENCES "ClientProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_nfcCardId_fkey" FOREIGN KEY ("nfcCardId") REFERENCES "NfcCard"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_triggerBookingId_fkey" FOREIGN KEY ("triggerBookingId") REFERENCES "Booking"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_professionalId_fkey" FOREIGN KEY ("professionalId") REFERENCES "ProfessionalProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_rewardBookingId_fkey" FOREIGN KEY ("rewardBookingId") REFERENCES "Booking"("id") ON DELETE SET NULL ON UPDATE CASCADE;
