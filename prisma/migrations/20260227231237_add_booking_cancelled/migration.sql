-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'BOOKING_CANCELLED';

-- AlterTable
ALTER TABLE "VerificationDocument" ADD COLUMN     "reviewedByAdminId" TEXT;

-- CreateIndex
CREATE INDEX "VerificationDocument_professionalId_createdAt_idx" ON "VerificationDocument"("professionalId", "createdAt");

-- CreateIndex
CREATE INDEX "VerificationDocument_status_createdAt_idx" ON "VerificationDocument"("status", "createdAt");

-- CreateIndex
CREATE INDEX "VerificationDocument_type_status_createdAt_idx" ON "VerificationDocument"("type", "status", "createdAt");

-- AddForeignKey
ALTER TABLE "VerificationDocument" ADD CONSTRAINT "VerificationDocument_reviewedByAdminId_fkey" FOREIGN KEY ("reviewedByAdminId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
