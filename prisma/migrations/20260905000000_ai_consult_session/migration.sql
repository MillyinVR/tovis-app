-- AI Consult, Phase 0, C1 (docs/design/ai-consult.md) — schema + route
-- skeleton. Foundation only: a client-facing pre-visit intake, unrelated to
-- the existing "Consultation" (ConsultationApproval / BookingConsultation)
-- mid-appointment price-approval flow.
--
-- ⚠️ MIGRATION NOTE: this is PURELY ADDITIVE.
--   • one new enum VALUE on "UploadSurface" ('CLIENT_CONSULT') — unused until
--     the signed-upload + quality-gate endpoint lands (C3);
--   • one new enum type, "ConsultSessionStatus";
--   • two new tables, "ConsultSession" and "ConsultPhoto", both starting EMPTY.
-- Nothing existing is altered, backfilled, dropped or re-typed. No existing row
-- changes, and no existing query's result changes. Rolling it back is a DROP
-- TABLE (x2) + DROP TYPE (the UploadSurface enum value would linger harmlessly
-- — Postgres cannot drop an enum value).
--
-- "ConsultPhoto" was added same-PR, before merge (Tori, 2026-08-06): consult
-- photos are a PERMANENT, dated hair-history record, not ephemeral capture
-- scaffolding, and cascade from "ConsultSession" rather than reusing
-- "MediaAsset" — see both models' doc comments in schema.prisma for the full
-- reasoning.

-- AlterEnum
ALTER TYPE "UploadSurface" ADD VALUE 'CLIENT_CONSULT';

-- CreateEnum
CREATE TYPE "ConsultSessionStatus" AS ENUM ('CREATED', 'INTAKE', 'ANALYZING', 'READY', 'CANCELLED');

-- CreateTable
CREATE TABLE "ConsultSession" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "serviceCategoryId" TEXT,
    "professionalId" TEXT,
    "bookingId" TEXT,
    "status" "ConsultSessionStatus" NOT NULL DEFAULT 'CREATED',
    "intakeAnswers" JSONB,
    "analysis" JSONB,
    "schemaVersion" INTEGER,
    "model" TEXT,
    "promptVersion" TEXT,
    "brief" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConsultSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ConsultSession_bookingId_key" ON "ConsultSession"("bookingId");

-- CreateIndex
CREATE INDEX "ConsultSession_clientId_createdAt_idx" ON "ConsultSession"("clientId", "createdAt");

-- CreateIndex
CREATE INDEX "ConsultSession_professionalId_status_idx" ON "ConsultSession"("professionalId", "status");

-- CreateIndex
CREATE INDEX "ConsultSession_serviceCategoryId_idx" ON "ConsultSession"("serviceCategoryId");

-- AddForeignKey
ALTER TABLE "ConsultSession" ADD CONSTRAINT "ConsultSession_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "ClientProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsultSession" ADD CONSTRAINT "ConsultSession_serviceCategoryId_fkey" FOREIGN KEY ("serviceCategoryId") REFERENCES "ServiceCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsultSession" ADD CONSTRAINT "ConsultSession_professionalId_fkey" FOREIGN KEY ("professionalId") REFERENCES "ProfessionalProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsultSession" ADD CONSTRAINT "ConsultSession_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "ConsultPhoto" (
    "id" TEXT NOT NULL,
    "consultSessionId" TEXT NOT NULL,
    "storageBucket" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "mediaType" "MediaType" NOT NULL DEFAULT 'IMAGE',
    "shotKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConsultPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ConsultPhoto_storageBucket_storagePath_key" ON "ConsultPhoto"("storageBucket", "storagePath");

-- CreateIndex
CREATE INDEX "ConsultPhoto_consultSessionId_createdAt_idx" ON "ConsultPhoto"("consultSessionId", "createdAt");

-- AddForeignKey
ALTER TABLE "ConsultPhoto" ADD CONSTRAINT "ConsultPhoto_consultSessionId_fkey" FOREIGN KEY ("consultSessionId") REFERENCES "ConsultSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
