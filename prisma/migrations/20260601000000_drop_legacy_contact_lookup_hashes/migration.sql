-- Drop legacy unkeyed SHA-256 contact lookup columns.
-- Contact lookup now uses HMAC-SHA256 v2 blind indexes with key versions.

ALTER TABLE "User"
  DROP COLUMN IF EXISTS "emailHash",
  DROP COLUMN IF EXISTS "phoneHash";

ALTER TABLE "ClientProfile"
  DROP COLUMN IF EXISTS "emailHash",
  DROP COLUMN IF EXISTS "phoneHash";