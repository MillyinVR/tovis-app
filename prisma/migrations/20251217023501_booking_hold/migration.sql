-- CreateTable
CREATE TABLE "BookingHold" (
    "id" TEXT NOT NULL,
    "offeringId" TEXT NOT NULL,
    "professionalId" TEXT NOT NULL,
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BookingHold_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BookingHold_offeringId_scheduledFor_idx" ON "BookingHold"("offeringId", "scheduledFor");

-- CreateIndex
CREATE INDEX "BookingHold_professionalId_scheduledFor_idx" ON "BookingHold"("professionalId", "scheduledFor");
