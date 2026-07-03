-- Client card-on-file foundation (Phase 2 revenue protection). Additive: one new
-- nullable column on ClientProfile (the client's Stripe Billing customer id) and
-- one new table caching saved-card display metadata. No existing data touched;
-- inert unless ENABLE_NO_SHOW_PROTECTION is on. No card is charged from this slice.

-- AlterTable
ALTER TABLE "ClientProfile" ADD COLUMN "stripeCustomerId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "ClientProfile_stripeCustomerId_key" ON "ClientProfile"("stripeCustomerId");

-- CreateTable
CREATE TABLE "ClientPaymentMethod" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "stripePaymentMethodId" TEXT NOT NULL,
    "brand" TEXT,
    "last4" VARCHAR(4),
    "expMonth" INTEGER,
    "expYear" INTEGER,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientPaymentMethod_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ClientPaymentMethod_stripePaymentMethodId_key" ON "ClientPaymentMethod"("stripePaymentMethodId");

-- CreateIndex
CREATE INDEX "ClientPaymentMethod_clientId_idx" ON "ClientPaymentMethod"("clientId");

-- AddForeignKey
ALTER TABLE "ClientPaymentMethod" ADD CONSTRAINT "ClientPaymentMethod_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "ClientProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
