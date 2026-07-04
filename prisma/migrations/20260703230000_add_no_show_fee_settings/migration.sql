-- No-show / late-cancel fee foundation (Phase 2 revenue protection). Additive:
-- two new enums, one new per-pro settings table, and six new nullable columns on
-- Booking recording the fee charge. No existing data touched; inert unless
-- ENABLE_NO_SHOW_PROTECTION is on — nothing charges a card while the flag is dark.
-- The NO_SHOW BookingStatus value itself was added in 20260703220000 (Postgres
-- requires ADD VALUE to commit before the label can be referenced).

-- CreateEnum
CREATE TYPE "NoShowFeeType" AS ENUM ('FLAT', 'PERCENT');

-- CreateEnum
CREATE TYPE "NoShowFeeReason" AS ENUM ('NO_SHOW', 'LATE_CANCEL');

-- CreateEnum
CREATE TYPE "NoShowFeeStatus" AS ENUM ('SKIPPED', 'CHARGED', 'FAILED', 'WAIVED');

-- AlterEnum: client-facing "no-show fee charged" receipt notification. Not
-- referenced in this migration's DML, so ADD VALUE in the same file is safe.
ALTER TYPE "NotificationEventKey" ADD VALUE 'NO_SHOW_FEE_CHARGED';

-- AlterTable
ALTER TABLE "Booking"
    ADD COLUMN "noShowMarkedAt" TIMESTAMP(3),
    ADD COLUMN "noShowFeeStatus" "NoShowFeeStatus",
    ADD COLUMN "noShowFeeAmount" DECIMAL(10,2),
    ADD COLUMN "noShowFeeStripePaymentIntentId" TEXT,
    ADD COLUMN "noShowFeeChargedAt" TIMESTAMP(3),
    ADD COLUMN "noShowFeeReason" "NoShowFeeReason";

-- CreateIndex
CREATE UNIQUE INDEX "Booking_noShowFeeStripePaymentIntentId_key" ON "Booking"("noShowFeeStripePaymentIntentId");

-- CreateTable
CREATE TABLE "ProNoShowSettings" (
    "id" TEXT NOT NULL,
    "professionalId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "feeType" "NoShowFeeType" NOT NULL DEFAULT 'FLAT',
    "feeFlatAmount" DECIMAL(10,2),
    "feePercent" INTEGER,
    "cancelWindowHours" INTEGER NOT NULL DEFAULT 24,
    "chargeNoShow" BOOLEAN NOT NULL DEFAULT true,
    "chargeLateCancel" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProNoShowSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProNoShowSettings_professionalId_key" ON "ProNoShowSettings"("professionalId");

-- CreateIndex
CREATE INDEX "ProNoShowSettings_professionalId_idx" ON "ProNoShowSettings"("professionalId");

-- AddForeignKey
ALTER TABLE "ProNoShowSettings" ADD CONSTRAINT "ProNoShowSettings_professionalId_fkey" FOREIGN KEY ("professionalId") REFERENCES "ProfessionalProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
