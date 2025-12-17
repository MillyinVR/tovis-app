-- CreateEnum
CREATE TYPE "ClientNoteVisibility" AS ENUM ('PROFESSIONALS_ONLY', 'ADMIN_ONLY');

-- CreateEnum
CREATE TYPE "AllergySeverity" AS ENUM ('LOW', 'MODERATE', 'HIGH', 'CRITICAL');

-- AlterTable
ALTER TABLE "ClientProfile" ADD COLUMN     "alertBanner" TEXT;

-- CreateTable
CREATE TABLE "ClientProfessionalNote" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "professionalId" TEXT NOT NULL,
    "title" TEXT,
    "body" TEXT NOT NULL,
    "visibility" "ClientNoteVisibility" NOT NULL DEFAULT 'PROFESSIONALS_ONLY',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientProfessionalNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Review" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "professionalId" TEXT NOT NULL,
    "bookingId" TEXT,
    "rating" INTEGER NOT NULL,
    "headline" TEXT,
    "body" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Review_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientAllergy" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "severity" "AllergySeverity" NOT NULL DEFAULT 'MODERATE',
    "recordedByProfessionalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientAllergy_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClientProfessionalNote_clientId_idx" ON "ClientProfessionalNote"("clientId");

-- CreateIndex
CREATE INDEX "ClientProfessionalNote_professionalId_createdAt_idx" ON "ClientProfessionalNote"("professionalId", "createdAt");

-- CreateIndex
CREATE INDEX "Review_professionalId_createdAt_idx" ON "Review"("professionalId", "createdAt");

-- CreateIndex
CREATE INDEX "Review_clientId_createdAt_idx" ON "Review"("clientId", "createdAt");

-- CreateIndex
CREATE INDEX "ClientAllergy_clientId_idx" ON "ClientAllergy"("clientId");

-- AddForeignKey
ALTER TABLE "ClientProfessionalNote" ADD CONSTRAINT "ClientProfessionalNote_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "ClientProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientProfessionalNote" ADD CONSTRAINT "ClientProfessionalNote_professionalId_fkey" FOREIGN KEY ("professionalId") REFERENCES "ProfessionalProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "ClientProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_professionalId_fkey" FOREIGN KEY ("professionalId") REFERENCES "ProfessionalProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientAllergy" ADD CONSTRAINT "ClientAllergy_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "ClientProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientAllergy" ADD CONSTRAINT "ClientAllergy_recordedByProfessionalId_fkey" FOREIGN KEY ("recordedByProfessionalId") REFERENCES "ProfessionalProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
