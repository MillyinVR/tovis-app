-- CreateEnum
CREATE TYPE "BookingServiceItemType" AS ENUM ('BASE', 'ADD_ON');

-- AlterTable
ALTER TABLE "BookingServiceItem" ADD COLUMN     "itemType" "BookingServiceItemType" NOT NULL DEFAULT 'BASE',
ADD COLUMN     "parentItemId" TEXT;

-- AlterTable
ALTER TABLE "Service" ADD COLUMN     "addOnGroup" TEXT,
ADD COLUMN     "isAddOnEligible" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "OfferingAddOn" (
    "id" TEXT NOT NULL,
    "offeringId" TEXT NOT NULL,
    "addOnServiceId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isRecommended" BOOLEAN NOT NULL DEFAULT false,
    "priceOverride" DECIMAL(10,2),
    "durationOverrideMinutes" INTEGER,
    "locationType" "ServiceLocationType",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OfferingAddOn_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OfferingAddOn_offeringId_isActive_sortOrder_idx" ON "OfferingAddOn"("offeringId", "isActive", "sortOrder");

-- CreateIndex
CREATE INDEX "OfferingAddOn_addOnServiceId_idx" ON "OfferingAddOn"("addOnServiceId");

-- CreateIndex
CREATE UNIQUE INDEX "OfferingAddOn_offeringId_addOnServiceId_key" ON "OfferingAddOn"("offeringId", "addOnServiceId");

-- CreateIndex
CREATE INDEX "BookingServiceItem_bookingId_itemType_idx" ON "BookingServiceItem"("bookingId", "itemType");

-- CreateIndex
CREATE INDEX "BookingServiceItem_parentItemId_idx" ON "BookingServiceItem"("parentItemId");

-- AddForeignKey
ALTER TABLE "OfferingAddOn" ADD CONSTRAINT "OfferingAddOn_offeringId_fkey" FOREIGN KEY ("offeringId") REFERENCES "ProfessionalServiceOffering"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfferingAddOn" ADD CONSTRAINT "OfferingAddOn_addOnServiceId_fkey" FOREIGN KEY ("addOnServiceId") REFERENCES "Service"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingServiceItem" ADD CONSTRAINT "BookingServiceItem_parentItemId_fkey" FOREIGN KEY ("parentItemId") REFERENCES "BookingServiceItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
