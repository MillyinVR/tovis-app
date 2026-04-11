-- CreateEnum
CREATE TYPE "ContactMethod" AS ENUM ('EMAIL', 'SMS');

-- CreateEnum
CREATE TYPE "ProClientInviteStatus" AS ENUM ('PENDING', 'ACCEPTED', 'EXPIRED');

-- AlterTable
ALTER TABLE "ClientProfile" ADD COLUMN     "preferredContactMethod" "ContactMethod";

-- CreateTable
CREATE TABLE "ProClientInvite" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "professionalId" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "invitedName" TEXT NOT NULL,
    "invitedEmail" TEXT,
    "invitedPhone" TEXT,
    "token" TEXT NOT NULL,
    "status" "ProClientInviteStatus" NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "acceptedByUserId" TEXT,
    "preferredContactMethod" "ContactMethod",

    CONSTRAINT "ProClientInvite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProClientInvite_bookingId_key" ON "ProClientInvite"("bookingId");

-- CreateIndex
CREATE UNIQUE INDEX "ProClientInvite_token_key" ON "ProClientInvite"("token");

-- CreateIndex
CREATE INDEX "ProClientInvite_professionalId_idx" ON "ProClientInvite"("professionalId");

-- CreateIndex
CREATE INDEX "ProClientInvite_token_idx" ON "ProClientInvite"("token");

-- CreateIndex
CREATE INDEX "ProClientInvite_status_expiresAt_idx" ON "ProClientInvite"("status", "expiresAt");

-- AddForeignKey
ALTER TABLE "ProClientInvite" ADD CONSTRAINT "ProClientInvite_professionalId_fkey" FOREIGN KEY ("professionalId") REFERENCES "ProfessionalProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProClientInvite" ADD CONSTRAINT "ProClientInvite_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;
