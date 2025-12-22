-- CreateEnum
CREATE TYPE "AdminPermissionRole" AS ENUM ('SUPER_ADMIN', 'SUPPORT', 'REVIEWER');

-- CreateTable
CREATE TABLE "AdminPermission" (
    "id" TEXT NOT NULL,
    "adminUserId" TEXT NOT NULL,
    "role" "AdminPermissionRole" NOT NULL DEFAULT 'SUPPORT',
    "professionalId" TEXT,
    "serviceId" TEXT,
    "categoryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminPermission_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AdminPermission_adminUserId_createdAt_idx" ON "AdminPermission"("adminUserId", "createdAt");

-- CreateIndex
CREATE INDEX "AdminPermission_professionalId_idx" ON "AdminPermission"("professionalId");

-- CreateIndex
CREATE INDEX "AdminPermission_serviceId_idx" ON "AdminPermission"("serviceId");

-- CreateIndex
CREATE INDEX "AdminPermission_categoryId_idx" ON "AdminPermission"("categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "AdminPermission_adminUserId_role_professionalId_serviceId_c_key" ON "AdminPermission"("adminUserId", "role", "professionalId", "serviceId", "categoryId");

-- AddForeignKey
ALTER TABLE "AdminPermission" ADD CONSTRAINT "AdminPermission_adminUserId_fkey" FOREIGN KEY ("adminUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminPermission" ADD CONSTRAINT "AdminPermission_professionalId_fkey" FOREIGN KEY ("professionalId") REFERENCES "ProfessionalProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminPermission" ADD CONSTRAINT "AdminPermission_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminPermission" ADD CONSTRAINT "AdminPermission_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ServiceCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;
