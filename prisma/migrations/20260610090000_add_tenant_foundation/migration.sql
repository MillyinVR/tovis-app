-- AlterTable
ALTER TABLE "ClientProfile" ADD COLUMN     "homeTenantId" TEXT;

-- AlterTable
ALTER TABLE "ProfessionalProfile" ADD COLUMN     "homeTenantId" TEXT;

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "clientHomeTenantId" TEXT,
ADD COLUMN     "proTenantId" TEXT;

-- AlterTable
ALTER TABLE "NfcCard" ADD COLUMN     "tenantId" TEXT;

-- CreateTable
CREATE TABLE "Tenant" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "customDomain" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Tenant_slug_key" ON "Tenant"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Tenant_customDomain_key" ON "Tenant"("customDomain");

-- CreateIndex
CREATE INDEX "Tenant_isActive_idx" ON "Tenant"("isActive");

-- CreateIndex
CREATE INDEX "ClientProfile_homeTenantId_idx" ON "ClientProfile"("homeTenantId");

-- CreateIndex
CREATE INDEX "ProfessionalProfile_homeTenantId_idx" ON "ProfessionalProfile"("homeTenantId");

-- CreateIndex
CREATE INDEX "Booking_proTenantId_scheduledFor_idx" ON "Booking"("proTenantId", "scheduledFor");

-- CreateIndex
CREATE INDEX "Booking_clientHomeTenantId_idx" ON "Booking"("clientHomeTenantId");

-- CreateIndex
CREATE INDEX "NfcCard_tenantId_idx" ON "NfcCard"("tenantId");

-- AddForeignKey
ALTER TABLE "ClientProfile" ADD CONSTRAINT "ClientProfile_homeTenantId_fkey" FOREIGN KEY ("homeTenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfessionalProfile" ADD CONSTRAINT "ProfessionalProfile_homeTenantId_fkey" FOREIGN KEY ("homeTenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_proTenantId_fkey" FOREIGN KEY ("proTenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_clientHomeTenantId_fkey" FOREIGN KEY ("clientHomeTenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NfcCard" ADD CONSTRAINT "NfcCard_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

