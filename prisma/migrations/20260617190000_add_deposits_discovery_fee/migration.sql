-- CreateEnum
CREATE TYPE "DepositType" AS ENUM ('FLAT', 'PERCENT');

-- CreateEnum
CREATE TYPE "DepositScope" AS ENUM ('NEW_DISCOVERY_ONLY', 'ALL_NEW_CLIENTS', 'ALL_CLIENTS');

-- CreateEnum
CREATE TYPE "BookingDiscoveryProvenance" AS ENUM ('UNKNOWN', 'LOOKS_FEED', 'DISCOVERY_SEARCH', 'DIRECT_PROFILE', 'NAME_SEARCH', 'NFC', 'AFTERCARE', 'PRO_CREATED');

-- CreateEnum
CREATE TYPE "BookingDepositStatus" AS ENUM ('NONE', 'PENDING', 'PAID', 'REFUNDED', 'FAILED');

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "depositCreditedAt" TIMESTAMP(3),
ADD COLUMN     "depositPaidAt" TIMESTAMP(3),
ADD COLUMN     "depositStatus" "BookingDepositStatus" NOT NULL DEFAULT 'NONE',
ADD COLUMN     "depositStripeChargeId" TEXT,
ADD COLUMN     "depositStripePaymentIntentId" TEXT,
ADD COLUMN     "discoveryFeeAmount" INTEGER,
ADD COLUMN     "discoveryFeeRefundedAt" TIMESTAMP(3),
ADD COLUMN     "discoveryProvenance" "BookingDiscoveryProvenance" NOT NULL DEFAULT 'UNKNOWN';

-- AlterTable
ALTER TABLE "BookingHold" ADD COLUMN     "discoveryProvenance" "BookingDiscoveryProvenance" NOT NULL DEFAULT 'UNKNOWN';

-- AlterTable
ALTER TABLE "ProfessionalPaymentSettings" ADD COLUMN     "depositEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "depositFlatAmount" DECIMAL(10,2),
ADD COLUMN     "depositPercent" INTEGER,
ADD COLUMN     "depositScope" "DepositScope" NOT NULL DEFAULT 'NEW_DISCOVERY_ONLY',
ADD COLUMN     "depositType" "DepositType" NOT NULL DEFAULT 'FLAT';

-- CreateIndex
CREATE UNIQUE INDEX "Booking_depositStripePaymentIntentId_key" ON "Booking"("depositStripePaymentIntentId");
