-- Add HMAC v2 lookup columns. Keep legacy SHA-256 hash columns during burn-in.

ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "emailHashV2" VARCHAR(128),
  ADD COLUMN IF NOT EXISTS "emailHashKeyVersion" INTEGER,
  ADD COLUMN IF NOT EXISTS "phoneHashV2" VARCHAR(128),
  ADD COLUMN IF NOT EXISTS "phoneHashKeyVersion" INTEGER;

ALTER TABLE "ClientProfile"
  ADD COLUMN IF NOT EXISTS "emailHashV2" VARCHAR(128),
  ADD COLUMN IF NOT EXISTS "emailHashKeyVersion" INTEGER,
  ADD COLUMN IF NOT EXISTS "phoneHashV2" VARCHAR(128),
  ADD COLUMN IF NOT EXISTS "phoneHashKeyVersion" INTEGER;

-- HMAC v2 lookup indexes.
CREATE UNIQUE INDEX IF NOT EXISTS "User_emailHashV2_key"
  ON "User"("emailHashV2");

CREATE UNIQUE INDEX IF NOT EXISTS "User_phoneHashV2_key"
  ON "User"("phoneHashV2");

CREATE UNIQUE INDEX IF NOT EXISTS "ClientProfile_emailHashV2_key"
  ON "ClientProfile"("emailHashV2");

CREATE UNIQUE INDEX IF NOT EXISTS "ClientProfile_phoneHashV2_key"
  ON "ClientProfile"("phoneHashV2");

CREATE INDEX IF NOT EXISTS "User_emailHashKeyVersion_idx"
  ON "User"("emailHashKeyVersion");

CREATE INDEX IF NOT EXISTS "User_phoneHashKeyVersion_idx"
  ON "User"("phoneHashKeyVersion");

CREATE INDEX IF NOT EXISTS "ClientProfile_emailHashKeyVersion_idx"
  ON "ClientProfile"("emailHashKeyVersion");

CREATE INDEX IF NOT EXISTS "ClientProfile_phoneHashKeyVersion_idx"
  ON "ClientProfile"("phoneHashKeyVersion");