-- Pro-proposed waitlist time offers: the true client-confirm gate for the
-- calendar "Offer a time" flow. The pro proposes a concrete slot (PENDING); the
-- client Confirms (→ a normal ACCEPTED booking) or Declines (entry stays ACTIVE
-- so the pro can re-offer). Additive — one new enum + one new table; no existing
-- data touched.

-- CreateEnum
CREATE TYPE "WaitlistOfferStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'CANCELLED');

-- CreateTable
CREATE TABLE "WaitlistOffer" (
    "id" TEXT NOT NULL,
    "waitlistEntryId" TEXT NOT NULL,
    "professionalId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "offeringId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "locationType" "ServiceLocationType" NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "status" "WaitlistOfferStatus" NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3),
    "bookingId" TEXT,
    "respondedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WaitlistOffer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WaitlistOffer_bookingId_key" ON "WaitlistOffer"("bookingId");

-- CreateIndex
CREATE INDEX "WaitlistOffer_waitlistEntryId_status_idx" ON "WaitlistOffer"("waitlistEntryId", "status");

-- CreateIndex
CREATE INDEX "WaitlistOffer_clientId_status_createdAt_idx" ON "WaitlistOffer"("clientId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "WaitlistOffer_professionalId_status_createdAt_idx" ON "WaitlistOffer"("professionalId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "WaitlistOffer_offeringId_idx" ON "WaitlistOffer"("offeringId");

-- CreateIndex
CREATE INDEX "WaitlistOffer_locationId_idx" ON "WaitlistOffer"("locationId");

-- CreateIndex
-- Partial unique index: at most one outstanding PENDING offer per waitlist
-- entry. Prisma can't express a partial unique index in the schema, so it is
-- applied directly here (superseding a still-PENDING offer sets it CANCELLED
-- inside the same transaction before the new PENDING row is inserted).
CREATE UNIQUE INDEX "WaitlistOffer_one_pending_per_entry" ON "WaitlistOffer"("waitlistEntryId") WHERE "status" = 'PENDING';

-- AddForeignKey
ALTER TABLE "WaitlistOffer" ADD CONSTRAINT "WaitlistOffer_waitlistEntryId_fkey" FOREIGN KEY ("waitlistEntryId") REFERENCES "WaitlistEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaitlistOffer" ADD CONSTRAINT "WaitlistOffer_professionalId_fkey" FOREIGN KEY ("professionalId") REFERENCES "ProfessionalProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaitlistOffer" ADD CONSTRAINT "WaitlistOffer_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "ClientProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaitlistOffer" ADD CONSTRAINT "WaitlistOffer_offeringId_fkey" FOREIGN KEY ("offeringId") REFERENCES "ProfessionalServiceOffering"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaitlistOffer" ADD CONSTRAINT "WaitlistOffer_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "ProfessionalLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaitlistOffer" ADD CONSTRAINT "WaitlistOffer_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE SET NULL ON UPDATE CASCADE;
