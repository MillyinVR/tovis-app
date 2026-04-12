-- CreateEnum
CREATE TYPE "ConsultationDecision" AS ENUM ('APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ConsultationApprovalProofMethod" AS ENUM ('REMOTE_SECURE_LINK', 'IN_PERSON_PRO_DEVICE');

-- CreateEnum
CREATE TYPE "ClientActionTokenKind" AS ENUM ('CONSULTATION_ACTION', 'AFTERCARE_ACCESS');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "BookingCloseoutAuditAction" ADD VALUE 'CONSULTATION_APPROVED_REMOTE';
ALTER TYPE "BookingCloseoutAuditAction" ADD VALUE 'CONSULTATION_REJECTED_REMOTE';
ALTER TYPE "BookingCloseoutAuditAction" ADD VALUE 'CONSULTATION_APPROVED_IN_PERSON';
ALTER TYPE "BookingCloseoutAuditAction" ADD VALUE 'CONSULTATION_REJECTED_IN_PERSON';

-- CreateTable
CREATE TABLE "ClientActionToken" (
    "id" TEXT NOT NULL,
    "kind" "ClientActionTokenKind" NOT NULL,
    "tokenHash" VARCHAR(128) NOT NULL,
    "singleUse" BOOLEAN NOT NULL DEFAULT true,
    "bookingId" TEXT NOT NULL,
    "consultationApprovalId" TEXT,
    "aftercareSummaryId" TEXT,
    "clientId" TEXT NOT NULL,
    "professionalId" TEXT NOT NULL,
    "deliveryMethod" "ContactMethod",
    "recipientEmailSnapshot" VARCHAR(320),
    "recipientPhoneSnapshot" VARCHAR(32),
    "issuedByUserId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "firstUsedAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "useCount" INTEGER NOT NULL DEFAULT 0,
    "revokedAt" TIMESTAMP(3),
    "revokeReason" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientActionToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsultationApprovalProof" (
    "id" TEXT NOT NULL,
    "consultationApprovalId" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "professionalId" TEXT NOT NULL,
    "decision" "ConsultationDecision" NOT NULL,
    "method" "ConsultationApprovalProofMethod" NOT NULL,
    "actedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recordedByUserId" TEXT,
    "clientActionTokenId" TEXT,
    "contactMethod" "ContactMethod",
    "destinationSnapshot" VARCHAR(320),
    "ipAddress" VARCHAR(64),
    "userAgent" TEXT,
    "contextJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConsultationApprovalProof_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ClientActionToken_tokenHash_key" ON "ClientActionToken"("tokenHash");

-- CreateIndex
CREATE INDEX "ClientActionToken_kind_expiresAt_idx" ON "ClientActionToken"("kind", "expiresAt");

-- CreateIndex
CREATE INDEX "ClientActionToken_bookingId_kind_createdAt_idx" ON "ClientActionToken"("bookingId", "kind", "createdAt");

-- CreateIndex
CREATE INDEX "ClientActionToken_consultationApprovalId_kind_createdAt_idx" ON "ClientActionToken"("consultationApprovalId", "kind", "createdAt");

-- CreateIndex
CREATE INDEX "ClientActionToken_aftercareSummaryId_kind_createdAt_idx" ON "ClientActionToken"("aftercareSummaryId", "kind", "createdAt");

-- CreateIndex
CREATE INDEX "ClientActionToken_clientId_kind_createdAt_idx" ON "ClientActionToken"("clientId", "kind", "createdAt");

-- CreateIndex
CREATE INDEX "ClientActionToken_professionalId_kind_createdAt_idx" ON "ClientActionToken"("professionalId", "kind", "createdAt");

-- CreateIndex
CREATE INDEX "ClientActionToken_issuedByUserId_createdAt_idx" ON "ClientActionToken"("issuedByUserId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ConsultationApprovalProof_consultationApprovalId_key" ON "ConsultationApprovalProof"("consultationApprovalId");

-- CreateIndex
CREATE UNIQUE INDEX "ConsultationApprovalProof_bookingId_key" ON "ConsultationApprovalProof"("bookingId");

-- CreateIndex
CREATE UNIQUE INDEX "ConsultationApprovalProof_clientActionTokenId_key" ON "ConsultationApprovalProof"("clientActionTokenId");

-- CreateIndex
CREATE INDEX "ConsultationApprovalProof_clientId_actedAt_idx" ON "ConsultationApprovalProof"("clientId", "actedAt");

-- CreateIndex
CREATE INDEX "ConsultationApprovalProof_professionalId_actedAt_idx" ON "ConsultationApprovalProof"("professionalId", "actedAt");

-- CreateIndex
CREATE INDEX "ConsultationApprovalProof_method_actedAt_idx" ON "ConsultationApprovalProof"("method", "actedAt");

-- CreateIndex
CREATE INDEX "ConsultationApprovalProof_decision_actedAt_idx" ON "ConsultationApprovalProof"("decision", "actedAt");

-- CreateIndex
CREATE INDEX "ConsultationApprovalProof_recordedByUserId_actedAt_idx" ON "ConsultationApprovalProof"("recordedByUserId", "actedAt");

-- AddForeignKey
ALTER TABLE "ClientActionToken" ADD CONSTRAINT "ClientActionToken_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientActionToken" ADD CONSTRAINT "ClientActionToken_consultationApprovalId_fkey" FOREIGN KEY ("consultationApprovalId") REFERENCES "ConsultationApproval"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientActionToken" ADD CONSTRAINT "ClientActionToken_aftercareSummaryId_fkey" FOREIGN KEY ("aftercareSummaryId") REFERENCES "AftercareSummary"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientActionToken" ADD CONSTRAINT "ClientActionToken_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "ClientProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientActionToken" ADD CONSTRAINT "ClientActionToken_professionalId_fkey" FOREIGN KEY ("professionalId") REFERENCES "ProfessionalProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientActionToken" ADD CONSTRAINT "ClientActionToken_issuedByUserId_fkey" FOREIGN KEY ("issuedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsultationApprovalProof" ADD CONSTRAINT "ConsultationApprovalProof_consultationApprovalId_fkey" FOREIGN KEY ("consultationApprovalId") REFERENCES "ConsultationApproval"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsultationApprovalProof" ADD CONSTRAINT "ConsultationApprovalProof_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsultationApprovalProof" ADD CONSTRAINT "ConsultationApprovalProof_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "ClientProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsultationApprovalProof" ADD CONSTRAINT "ConsultationApprovalProof_professionalId_fkey" FOREIGN KEY ("professionalId") REFERENCES "ProfessionalProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsultationApprovalProof" ADD CONSTRAINT "ConsultationApprovalProof_recordedByUserId_fkey" FOREIGN KEY ("recordedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsultationApprovalProof" ADD CONSTRAINT "ConsultationApprovalProof_clientActionTokenId_fkey" FOREIGN KEY ("clientActionTokenId") REFERENCES "ClientActionToken"("id") ON DELETE SET NULL ON UPDATE CASCADE;
