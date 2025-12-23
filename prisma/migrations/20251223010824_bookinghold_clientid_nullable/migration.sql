-- AlterTable
ALTER TABLE "BookingHold" ADD COLUMN     "clientId" TEXT;

-- CreateIndex
CREATE INDEX "BookingHold_clientId_expiresAt_idx" ON "BookingHold"("clientId", "expiresAt");

-- AddForeignKey
ALTER TABLE "BookingHold" ADD CONSTRAINT "BookingHold_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "ClientProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
