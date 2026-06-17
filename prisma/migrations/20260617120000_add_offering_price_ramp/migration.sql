-- CreateEnum
CREATE TYPE "RaiseStepMode" AS ENUM ('PCT', 'USD');

-- CreateTable
CREATE TABLE "OfferingPriceRamp" (
    "id" TEXT NOT NULL,
    "offeringId" TEXT NOT NULL,
    "mode" "ServiceLocationType" NOT NULL,
    "grandfatheredPrice" DECIMAL(10,2) NOT NULL,
    "targetPrice" DECIMAL(10,2) NOT NULL,
    "currentPrice" DECIMAL(10,2) NOT NULL,
    "stepMode" "RaiseStepMode" NOT NULL,
    "stepValue" DECIMAL(10,2) NOT NULL,
    "cadenceWeeks" INTEGER NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "nextStepAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OfferingPriceRamp_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OfferingPriceRamp_completedAt_nextStepAt_idx" ON "OfferingPriceRamp"("completedAt", "nextStepAt");

-- CreateIndex
CREATE UNIQUE INDEX "OfferingPriceRamp_offeringId_mode_key" ON "OfferingPriceRamp"("offeringId", "mode");

-- AddForeignKey
ALTER TABLE "OfferingPriceRamp" ADD CONSTRAINT "OfferingPriceRamp_offeringId_fkey" FOREIGN KEY ("offeringId") REFERENCES "ProfessionalServiceOffering"("id") ON DELETE CASCADE ON UPDATE CASCADE;

