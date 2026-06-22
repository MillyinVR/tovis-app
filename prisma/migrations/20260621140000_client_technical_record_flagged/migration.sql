-- Client technical record (PR4 — legal-gated, flagged ENABLE_CLIENT_TECHNICAL_RECORD).
--
-- Additive / expand-only — safe to apply online:
--   * 4 new enums
--   * 2 new tables (ClientFormulaEntry, ClientConsentRecord) — pro-authored,
--     default PRIVATE_TO_AUTHOR; two-tier retention (persist past the 30-day window)
--   * ClientProfile photo-release columns (status NOT NULL DEFAULT 'NOT_SET' — safe
--     on existing rows; the rest nullable)
--
-- No backfill, no drops. All reads/writes are gated behind the feature flag, so
-- the application never touches these objects until the flag is enabled.

-- CreateEnum
CREATE TYPE "ClientConsentKind" AS ENUM ('GENERAL_CONSENT', 'SERVICE_WAIVER', 'PATCH_TEST');

-- CreateEnum
CREATE TYPE "ConsentProofMethod" AS ENUM ('IN_PERSON', 'CLIENT_TOKEN', 'PAPER_ON_FILE');

-- CreateEnum
CREATE TYPE "PatchTestResult" AS ENUM ('PASS', 'FAIL', 'INCONCLUSIVE');

-- CreateEnum
CREATE TYPE "PhotoReleaseStatus" AS ENUM ('NOT_SET', 'GRANTED', 'DECLINED');

-- AlterTable
ALTER TABLE "ClientProfile" ADD COLUMN     "photoReleaseAt" TIMESTAMP(3),
ADD COLUMN     "photoReleaseByProfessionalId" TEXT,
ADD COLUMN     "photoReleaseStatus" "PhotoReleaseStatus" NOT NULL DEFAULT 'NOT_SET';

-- CreateTable
CREATE TABLE "ClientFormulaEntry" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "clientId" TEXT NOT NULL,
    "professionalId" TEXT NOT NULL,
    "bookingId" TEXT,
    "brand" TEXT,
    "developer" TEXT,
    "ratio" TEXT,
    "processingTimeMinutes" INTEGER,
    "resultNotesEncrypted" JSONB,
    "visibility" "ClientNoteVisibility" NOT NULL DEFAULT 'PRIVATE_TO_AUTHOR',

    CONSTRAINT "ClientFormulaEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientConsentRecord" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "clientId" TEXT NOT NULL,
    "professionalId" TEXT NOT NULL,
    "bookingId" TEXT,
    "kind" "ClientConsentKind" NOT NULL,
    "serviceScope" TEXT,
    "signedAt" TIMESTAMP(3),
    "proofMethod" "ConsentProofMethod",
    "proofRef" TEXT,
    "patchTestResult" "PatchTestResult",
    "validUntil" TIMESTAMP(3),
    "notesEncrypted" JSONB,
    "visibility" "ClientNoteVisibility" NOT NULL DEFAULT 'PRIVATE_TO_AUTHOR',

    CONSTRAINT "ClientConsentRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClientFormulaEntry_professionalId_clientId_createdAt_idx" ON "ClientFormulaEntry"("professionalId", "clientId", "createdAt");

-- CreateIndex
CREATE INDEX "ClientFormulaEntry_clientId_createdAt_idx" ON "ClientFormulaEntry"("clientId", "createdAt");

-- CreateIndex
CREATE INDEX "ClientFormulaEntry_bookingId_idx" ON "ClientFormulaEntry"("bookingId");

-- CreateIndex
CREATE INDEX "ClientConsentRecord_professionalId_clientId_createdAt_idx" ON "ClientConsentRecord"("professionalId", "clientId", "createdAt");

-- CreateIndex
CREATE INDEX "ClientConsentRecord_clientId_kind_validUntil_idx" ON "ClientConsentRecord"("clientId", "kind", "validUntil");

-- CreateIndex
CREATE INDEX "ClientConsentRecord_bookingId_idx" ON "ClientConsentRecord"("bookingId");

-- AddForeignKey
ALTER TABLE "ClientFormulaEntry" ADD CONSTRAINT "ClientFormulaEntry_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "ClientProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientFormulaEntry" ADD CONSTRAINT "ClientFormulaEntry_professionalId_fkey" FOREIGN KEY ("professionalId") REFERENCES "ProfessionalProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientFormulaEntry" ADD CONSTRAINT "ClientFormulaEntry_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientConsentRecord" ADD CONSTRAINT "ClientConsentRecord_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "ClientProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientConsentRecord" ADD CONSTRAINT "ClientConsentRecord_professionalId_fkey" FOREIGN KEY ("professionalId") REFERENCES "ProfessionalProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientConsentRecord" ADD CONSTRAINT "ClientConsentRecord_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE SET NULL ON UPDATE CASCADE;
