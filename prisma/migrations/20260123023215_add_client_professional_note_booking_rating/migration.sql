/*
  Warnings:

  - A unique constraint covering the columns `[professionalId,bookingId]` on the table `ClientProfessionalNote` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterEnum
ALTER TYPE "ClientNoteVisibility" ADD VALUE 'PRIVATE_TO_AUTHOR';

-- DropForeignKey
ALTER TABLE "ClientProfessionalNote" DROP CONSTRAINT "ClientProfessionalNote_clientId_fkey";

-- DropForeignKey
ALTER TABLE "ClientProfessionalNote" DROP CONSTRAINT "ClientProfessionalNote_professionalId_fkey";

-- DropIndex
DROP INDEX "ClientProfessionalNote_clientId_idx";

-- AlterTable
ALTER TABLE "ClientProfessionalNote" ADD COLUMN     "bookingId" TEXT,
ADD COLUMN     "rating" INTEGER;

-- CreateIndex
CREATE INDEX "ClientProfessionalNote_clientId_createdAt_idx" ON "ClientProfessionalNote"("clientId", "createdAt");

-- CreateIndex
CREATE INDEX "ClientProfessionalNote_bookingId_idx" ON "ClientProfessionalNote"("bookingId");

-- CreateIndex
CREATE UNIQUE INDEX "ClientProfessionalNote_professionalId_bookingId_key" ON "ClientProfessionalNote"("professionalId", "bookingId");

-- AddForeignKey
ALTER TABLE "ClientProfessionalNote" ADD CONSTRAINT "ClientProfessionalNote_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientProfessionalNote" ADD CONSTRAINT "ClientProfessionalNote_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "ClientProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientProfessionalNote" ADD CONSTRAINT "ClientProfessionalNote_professionalId_fkey" FOREIGN KEY ("professionalId") REFERENCES "ProfessionalProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
