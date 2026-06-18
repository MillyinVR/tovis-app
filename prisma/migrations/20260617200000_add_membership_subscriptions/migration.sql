-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('ACTIVE', 'TRIALING', 'PAST_DUE', 'CANCELED', 'INCOMPLETE');

-- CreateTable
CREATE TABLE "SubscriptionPlan" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "priceCents" INTEGER NOT NULL DEFAULT 0,
    "interval" TEXT,
    "stripeProductId" TEXT,
    "stripePriceId" TEXT,
    "features" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubscriptionPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProfessionalSubscription" (
    "id" TEXT NOT NULL,
    "professionalId" TEXT NOT NULL,
    "planKey" TEXT NOT NULL DEFAULT 'free',
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
    "stripeCustomerId" TEXT,
    "stripeSubscriptionId" TEXT,
    "currentPeriodEnd" TIMESTAMP(3),
    "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    "trialEndsAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProfessionalSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionPlan_key_key" ON "SubscriptionPlan"("key");

-- CreateIndex
CREATE UNIQUE INDEX "ProfessionalSubscription_professionalId_key" ON "ProfessionalSubscription"("professionalId");

-- CreateIndex
CREATE UNIQUE INDEX "ProfessionalSubscription_stripeCustomerId_key" ON "ProfessionalSubscription"("stripeCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "ProfessionalSubscription_stripeSubscriptionId_key" ON "ProfessionalSubscription"("stripeSubscriptionId");

-- CreateIndex
CREATE INDEX "ProfessionalSubscription_planKey_idx" ON "ProfessionalSubscription"("planKey");

-- CreateIndex
CREATE INDEX "ProfessionalSubscription_status_idx" ON "ProfessionalSubscription"("status");

-- CreateIndex
CREATE INDEX "ProfessionalSubscription_stripeCustomerId_idx" ON "ProfessionalSubscription"("stripeCustomerId");

-- CreateIndex
CREATE INDEX "ProfessionalSubscription_stripeSubscriptionId_idx" ON "ProfessionalSubscription"("stripeSubscriptionId");

-- AddForeignKey
ALTER TABLE "ProfessionalSubscription" ADD CONSTRAINT "ProfessionalSubscription_professionalId_fkey" FOREIGN KEY ("professionalId") REFERENCES "ProfessionalProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

