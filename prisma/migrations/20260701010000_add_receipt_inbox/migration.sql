-- Pro Finance receipt inbox: a review queue for captured receipts (manual upload
-- or forwarded email) that become expenses only once the pro confirms.
-- Additive — no existing data touched.

-- CreateEnum
CREATE TYPE "ReceiptSource" AS ENUM ('UPLOAD', 'EMAIL', 'COSMOPROF', 'SALON_CENTRIC');

-- CreateEnum
CREATE TYPE "ReceiptStatus" AS ENUM ('PENDING', 'CONFIRMED', 'DISMISSED');

-- CreateTable
CREATE TABLE "ProfessionalReceiptInbox" (
    "id" TEXT NOT NULL,
    "professionalId" TEXT NOT NULL,
    "source" "ReceiptSource" NOT NULL,
    "status" "ReceiptStatus" NOT NULL DEFAULT 'PENDING',
    "parsedAmountCents" INTEGER,
    "parsedVendor" TEXT,
    "parsedDate" TIMESTAMP(3),
    "emailFrom" TEXT,
    "emailSubject" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "receiptMediaId" TEXT,
    "createdExpenseId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProfessionalReceiptInbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProfessionalReceiptInbox_professionalId_status_receivedAt_idx" ON "ProfessionalReceiptInbox"("professionalId", "status", "receivedAt");

-- CreateIndex
CREATE INDEX "ProfessionalReceiptInbox_receiptMediaId_idx" ON "ProfessionalReceiptInbox"("receiptMediaId");

-- AddForeignKey
ALTER TABLE "ProfessionalReceiptInbox" ADD CONSTRAINT "ProfessionalReceiptInbox_professionalId_fkey" FOREIGN KEY ("professionalId") REFERENCES "ProfessionalProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfessionalReceiptInbox" ADD CONSTRAINT "ProfessionalReceiptInbox_receiptMediaId_fkey" FOREIGN KEY ("receiptMediaId") REFERENCES "MediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;
