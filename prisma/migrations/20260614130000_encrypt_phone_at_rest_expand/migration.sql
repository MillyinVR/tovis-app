-- Phone-at-rest encryption — EXPAND phase.
-- See docs/security/ticket-encrypt-phone-at-rest.md.
--
--   - User.phoneEncrypted          — AEAD envelope for the displayable phone, written
--                                     alongside the existing phoneHashV2 lookup anchor.
--   - ClientProfile.phoneEncrypted — same, mirrored on the client profile.
--
-- The plaintext `phone` columns and `phoneHashV2` lookup anchors are untouched and
-- remain the source of truth during burn-in; the encrypted copy is dual-written at
-- every phone write site and backfilled for existing rows. The plaintext column is
-- dropped only in the later contract migration, after the reader cutover.
--
-- Adding nullable columns is metadata-only (no table rewrite, no blocking lock).
-- Idempotent (IF NOT EXISTS) so manual reruns / manual prod application are safe.

ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "phoneEncrypted" JSONB;

ALTER TABLE "ClientProfile"
  ADD COLUMN IF NOT EXISTS "phoneEncrypted" JSONB;
