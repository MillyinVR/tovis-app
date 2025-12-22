-- DropForeignKey
ALTER TABLE "AdminActionLog" DROP CONSTRAINT "AdminActionLog_professionalId_fkey";

-- AlterTable
ALTER TABLE "AdminActionLog" ADD COLUMN     "categoryId" TEXT,
ADD COLUMN     "serviceId" TEXT,
ALTER COLUMN "professionalId" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "AdminActionLog_serviceId_createdAt_idx" ON "AdminActionLog"("serviceId", "createdAt");

-- CreateIndex
CREATE INDEX "AdminActionLog_categoryId_createdAt_idx" ON "AdminActionLog"("categoryId", "createdAt");

-- AddForeignKey
ALTER TABLE "AdminActionLog" ADD CONSTRAINT "AdminActionLog_professionalId_fkey" FOREIGN KEY ("professionalId") REFERENCES "ProfessionalProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminActionLog" ADD CONSTRAINT "AdminActionLog_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminActionLog" ADD CONSTRAINT "AdminActionLog_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ServiceCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;
