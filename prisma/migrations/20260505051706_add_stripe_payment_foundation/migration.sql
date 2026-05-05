/*
  Warnings:

  - A unique constraint covering the columns `[stripeCheckoutSessionId]` on the table `Booking` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[stripePaymentIntentId]` on the table `Booking` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[stripeAccountId]` on the table `ProfessionalPaymentSettings` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "PaymentProvider" AS ENUM ('MANUAL', 'STRIPE');

-- CreateEnum
CREATE TYPE "StripeAccountStatus" AS ENUM ('NOT_STARTED', 'ONBOARDING_STARTED', 'RESTRICTED', 'ENABLED', 'DISABLED');

-- CreateEnum
CREATE TYPE "StripeCheckoutSessionStatus" AS ENUM ('OPEN', 'COMPLETE', 'EXPIRED');

-- CreateEnum
CREATE TYPE "StripePaymentStatus" AS ENUM ('NOT_STARTED', 'REQUIRES_PAYMENT_METHOD', 'REQUIRES_CONFIRMATION', 'REQUIRES_ACTION', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'CANCELED', 'REFUNDED', 'DISPUTED');

-- AlterEnum
ALTER TYPE "PaymentMethod" ADD VALUE 'STRIPE_CARD';

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "paymentProvider" "PaymentProvider" NOT NULL DEFAULT 'MANUAL',
ADD COLUMN     "stripeAmountSubtotal" INTEGER,
ADD COLUMN     "stripeAmountTotal" INTEGER,
ADD COLUMN     "stripeApplicationFeeAmount" INTEGER,
ADD COLUMN     "stripeCheckoutSessionId" TEXT,
ADD COLUMN     "stripeCheckoutSessionStatus" "StripeCheckoutSessionStatus",
ADD COLUMN     "stripeConnectedAccountId" TEXT,
ADD COLUMN     "stripeCurrency" VARCHAR(3),
ADD COLUMN     "stripeLastEventId" TEXT,
ADD COLUMN     "stripePaidAt" TIMESTAMP(3),
ADD COLUMN     "stripePaymentIntentId" TEXT,
ADD COLUMN     "stripePaymentStatus" "StripePaymentStatus";

-- AlterTable
ALTER TABLE "ProfessionalPaymentSettings" ADD COLUMN     "acceptStripeCard" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "stripeAccountId" TEXT,
ADD COLUMN     "stripeAccountStatus" "StripeAccountStatus" NOT NULL DEFAULT 'NOT_STARTED',
ADD COLUMN     "stripeAccountUpdatedAt" TIMESTAMP(3),
ADD COLUMN     "stripeChargesEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "stripeDetailsSubmitted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "stripeOnboardingCompletedAt" TIMESTAMP(3),
ADD COLUMN     "stripeOnboardingStartedAt" TIMESTAMP(3),
ADD COLUMN     "stripePayoutsEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "stripeRequirementsCurrentlyDue" JSONB,
ADD COLUMN     "stripeRequirementsEventuallyDue" JSONB;

-- CreateTable
CREATE TABLE "StripeWebhookEvent" (
    "id" TEXT NOT NULL,
    "stripeEventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "livemode" BOOLEAN NOT NULL DEFAULT false,
    "processedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StripeWebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StripeWebhookEvent_stripeEventId_key" ON "StripeWebhookEvent"("stripeEventId");

-- CreateIndex
CREATE INDEX "StripeWebhookEvent_eventType_createdAt_idx" ON "StripeWebhookEvent"("eventType", "createdAt");

-- CreateIndex
CREATE INDEX "StripeWebhookEvent_processedAt_createdAt_idx" ON "StripeWebhookEvent"("processedAt", "createdAt");

-- CreateIndex
CREATE INDEX "StripeWebhookEvent_failedAt_createdAt_idx" ON "StripeWebhookEvent"("failedAt", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Booking_stripeCheckoutSessionId_key" ON "Booking"("stripeCheckoutSessionId");

-- CreateIndex
CREATE UNIQUE INDEX "Booking_stripePaymentIntentId_key" ON "Booking"("stripePaymentIntentId");

-- CreateIndex
CREATE INDEX "Booking_stripePaymentIntentId_idx" ON "Booking"("stripePaymentIntentId");

-- CreateIndex
CREATE INDEX "Booking_stripeCheckoutSessionId_idx" ON "Booking"("stripeCheckoutSessionId");

-- CreateIndex
CREATE INDEX "Booking_stripeConnectedAccountId_idx" ON "Booking"("stripeConnectedAccountId");

-- CreateIndex
CREATE INDEX "Booking_paymentProvider_checkoutStatus_idx" ON "Booking"("paymentProvider", "checkoutStatus");

-- CreateIndex
CREATE UNIQUE INDEX "ProfessionalPaymentSettings_stripeAccountId_key" ON "ProfessionalPaymentSettings"("stripeAccountId");

-- CreateIndex
CREATE INDEX "ProfessionalPaymentSettings_stripeAccountId_idx" ON "ProfessionalPaymentSettings"("stripeAccountId");

-- CreateIndex
CREATE INDEX "ProfessionalPaymentSettings_stripeAccountStatus_idx" ON "ProfessionalPaymentSettings"("stripeAccountStatus");
