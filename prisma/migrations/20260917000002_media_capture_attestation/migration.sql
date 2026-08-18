-- Additive only — one new table, nothing existing is touched — so the deploy
-- is safe to run ahead of the code that reads it.
--
-- MediaCaptureAttestation is the append-only tamper-evidence record for a
-- captured MediaAsset: sha256Server is computed by the server from the bytes
-- Supabase actually stored (the only hash this app trusts); sha256Client is
-- what the uploader claimed, kept only for comparison. There is no update
-- statement anywhere in the app for this table by design — the only delete
-- path is the account-deletion boundary (lib/privacy/deleteRules.ts), and
-- mediaAssetId cascades so that boundary never needs a hand-written pre-step
-- for this table.
--
-- 🔴 Backfill: none. Only new uploads from this point on get an attestation
-- row — every MediaAsset created before this migration has no capture record
-- and an evidence bundle must say so honestly rather than imply completeness.

-- CreateTable
CREATE TABLE "MediaCaptureAttestation" (
    "id" TEXT NOT NULL,
    "mediaAssetId" TEXT NOT NULL,
    "bookingId" TEXT,
    "professionalId" TEXT NOT NULL,
    "sha256Server" TEXT NOT NULL,
    "sha256Client" TEXT,
    "hashMismatch" BOOLEAN NOT NULL DEFAULT false,
    "capturedAtClaimed" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MediaCaptureAttestation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MediaCaptureAttestation_mediaAssetId_key" ON "MediaCaptureAttestation"("mediaAssetId");

-- CreateIndex
CREATE INDEX "MediaCaptureAttestation_bookingId_idx" ON "MediaCaptureAttestation"("bookingId");

-- CreateIndex
CREATE INDEX "MediaCaptureAttestation_professionalId_createdAt_idx" ON "MediaCaptureAttestation"("professionalId", "createdAt");

-- AddForeignKey
ALTER TABLE "MediaCaptureAttestation" ADD CONSTRAINT "MediaCaptureAttestation_mediaAssetId_fkey" FOREIGN KEY ("mediaAssetId") REFERENCES "MediaAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaCaptureAttestation" ADD CONSTRAINT "MediaCaptureAttestation_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaCaptureAttestation" ADD CONSTRAINT "MediaCaptureAttestation_professionalId_fkey" FOREIGN KEY ("professionalId") REFERENCES "ProfessionalProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Row-level security: deny-all posture, no policies. All access goes through
-- Prisma (which connects as the table owner and bypasses RLS); this only
-- blocks a client hitting the table directly via Supabase's REST/anon role.
-- See tests/integration/database-hardening.test.ts, the guard that would
-- otherwise let a new table silently ship without it.
ALTER TABLE "MediaCaptureAttestation" ENABLE ROW LEVEL SECURITY;
