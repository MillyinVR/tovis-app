-- Restore plaintext phone contact fields kept during contact lookup hash burn-in.
-- This migration is intentionally idempotent because the dev database may already
-- have some of these columns/indexes from earlier schema experiments.

ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "phone" VARCHAR(32);

ALTER TABLE "ClientProfile"
  ADD COLUMN IF NOT EXISTS "phone" VARCHAR(32);

CREATE UNIQUE INDEX IF NOT EXISTS "User_phone_key"
  ON "User"("phone");

CREATE UNIQUE INDEX IF NOT EXISTS "ClientProfile_phone_key"
  ON "ClientProfile"("phone");