-- Tier-3 health-adjacent note encryption — EXPAND phase (slice 1: ClientAllergy +
-- ClientProfessionalNote). See docs/security/ticket-encrypt-tier3-health-notes.md.
--
-- Adds nullable AEAD-envelope columns alongside the existing plaintext columns.
-- Writers dual-write plaintext + envelope; a backfill encrypts existing rows;
-- readers cut over after burn-in; a later CONTRACT migration drops the plaintext.
--
-- Adding nullable columns is metadata-only (no table rewrite, no blocking lock).
-- Written in the idempotent style (IF NOT EXISTS) so manual reruns / manual prod
-- application are safe, matching the surrounding migrations.

ALTER TABLE "ClientAllergy"
  ADD COLUMN IF NOT EXISTS "labelEncrypted" JSONB,
  ADD COLUMN IF NOT EXISTS "descriptionEncrypted" JSONB;

ALTER TABLE "ClientProfessionalNote"
  ADD COLUMN IF NOT EXISTS "titleEncrypted" JSONB,
  ADD COLUMN IF NOT EXISTS "bodyEncrypted" JSONB;
