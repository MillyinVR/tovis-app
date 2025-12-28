-- CreateEnum
CREATE TYPE "ConsultationApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "ConsultationApproval" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "status" "ConsultationApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "approvedAt" TIMESTAMP(3),
    "rejectedAt" TIMESTAMP(3),
    "proposedServicesJson" JSONB NOT NULL,
    "proposedTotal" DECIMAL(65,30),
    "notes" TEXT,
    "bookingId" TEXT NOT NULL,
    "clientId" TEXT,
    "proId" TEXT,

    CONSTRAINT "ConsultationApproval_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ConsultationApproval_bookingId_key" ON "ConsultationApproval"("bookingId");

-- CreateIndex
CREATE INDEX "ConsultationApproval_status_idx" ON "ConsultationApproval"("status");

-- AddForeignKey
ALTER TABLE "ConsultationApproval" ADD CONSTRAINT "ConsultationApproval_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;
