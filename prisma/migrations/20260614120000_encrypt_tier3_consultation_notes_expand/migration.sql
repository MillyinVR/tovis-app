-- Tier-3 health-adjacent note encryption — EXPAND phase (slice 2: consultation
-- free-text). See docs/security/ticket-encrypt-tier3-health-notes.md.
--
--   - ConsultationApproval.notes        — the LIVE canonical consultation free-text
--                                         (written by the proposal upsert; dual-write).
--   - Booking.consultationNotes         — LEGACY negotiated-outcome scalar with no
--                                         current writer; backfill-only, read surface
--                                         cut over later, dropped in the contract migration.
--
-- (The ticket's BookingConsultation relation is a dead model with no write sites,
-- and BookingCloseoutAuditLog holds no note-text snapshots, so neither is in scope.)
--
-- Adding nullable columns is metadata-only (no table rewrite, no blocking lock).
-- Idempotent (IF NOT EXISTS) so manual reruns / manual prod application are safe.

ALTER TABLE "ConsultationApproval"
  ADD COLUMN IF NOT EXISTS "notesEncrypted" JSONB;

ALTER TABLE "Booking"
  ADD COLUMN IF NOT EXISTS "consultationNotesEncrypted" JSONB;
