-- CreateTable
CREATE TABLE "AftercareRebookSlot" (
    "id" TEXT NOT NULL,
    "aftercareSummaryId" TEXT NOT NULL,
    "professionalId" TEXT NOT NULL,
    "offeringId" TEXT,
    "locationId" TEXT NOT NULL,
    "locationType" "ServiceLocationType" NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AftercareRebookSlot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AftercareRebookSlot_aftercareSummaryId_key" ON "AftercareRebookSlot"("aftercareSummaryId");

-- CreateIndex
CREATE INDEX "AftercareRebookSlot_professionalId_startsAt_idx" ON "AftercareRebookSlot"("professionalId", "startsAt");

-- CreateIndex
CREATE INDEX "AftercareRebookSlot_locationId_startsAt_idx" ON "AftercareRebookSlot"("locationId", "startsAt");

-- CreateIndex
CREATE INDEX "AftercareRebookSlot_offeringId_idx" ON "AftercareRebookSlot"("offeringId");

-- AddForeignKey
ALTER TABLE "AftercareRebookSlot" ADD CONSTRAINT "AftercareRebookSlot_aftercareSummaryId_fkey" FOREIGN KEY ("aftercareSummaryId") REFERENCES "AftercareSummary"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AftercareRebookSlot" ADD CONSTRAINT "AftercareRebookSlot_professionalId_fkey" FOREIGN KEY ("professionalId") REFERENCES "ProfessionalProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AftercareRebookSlot" ADD CONSTRAINT "AftercareRebookSlot_offeringId_fkey" FOREIGN KEY ("offeringId") REFERENCES "ProfessionalServiceOffering"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AftercareRebookSlot" ADD CONSTRAINT "AftercareRebookSlot_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "ProfessionalLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

