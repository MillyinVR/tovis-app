-- AlterTable
ALTER TABLE "AftercareRebookSlot" ADD COLUMN     "clientAddressId" TEXT;

-- CreateIndex
CREATE INDEX "AftercareRebookSlot_clientAddressId_idx" ON "AftercareRebookSlot"("clientAddressId");

-- AddForeignKey
ALTER TABLE "AftercareRebookSlot" ADD CONSTRAINT "AftercareRebookSlot_clientAddressId_fkey" FOREIGN KEY ("clientAddressId") REFERENCES "ClientAddress"("id") ON DELETE SET NULL ON UPDATE CASCADE;
