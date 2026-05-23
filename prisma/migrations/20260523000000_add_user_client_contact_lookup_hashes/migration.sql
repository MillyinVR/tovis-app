-- Add lookup hashes for canonical user/client contact fields.
--
-- Expand-only migration:
-- - Adds nullable hash columns.
-- - Backfills from existing raw email/phone values.
-- - Adds unique indexes for non-null hashes.
-- - Keeps raw email/phone fields unchanged.
--
-- Contract phase later may encrypt or minimize raw contact fields after all
-- reads/writes have moved to hash-aware paths.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "emailHash" VARCHAR(128),
  ADD COLUMN IF NOT EXISTS "phoneHash" VARCHAR(128);

ALTER TABLE "ClientProfile"
  ADD COLUMN IF NOT EXISTS "emailHash" VARCHAR(128),
  ADD COLUMN IF NOT EXISTS "phoneHash" VARCHAR(128);

UPDATE "User"
SET "emailHash" = encode(digest(lower(trim("email")), 'sha256'), 'hex')
WHERE "email" IS NOT NULL
  AND trim("email") <> ''
  AND "emailHash" IS NULL;

UPDATE "User"
SET "phoneHash" = encode(digest(
    CASE
      WHEN regexp_replace("phone", '\D', '', 'g') ~ '^1[0-9]{10}$'
        THEN '+' || regexp_replace("phone", '\D', '', 'g')
      WHEN regexp_replace("phone", '\D', '', 'g') ~ '^[0-9]{10}$'
        THEN '+1' || regexp_replace("phone", '\D', '', 'g')
      WHEN regexp_replace("phone", '\D', '', 'g') <> ''
        THEN '+' || regexp_replace("phone", '\D', '', 'g')
      ELSE NULL
    END,
    'sha256'
  ), 'hex')
WHERE "phone" IS NOT NULL
  AND trim("phone") <> ''
  AND regexp_replace("phone", '\D', '', 'g') <> ''
  AND "phoneHash" IS NULL;

UPDATE "ClientProfile"
SET "emailHash" = encode(digest(lower(trim("email")), 'sha256'), 'hex')
WHERE "email" IS NOT NULL
  AND trim("email") <> ''
  AND "emailHash" IS NULL;

UPDATE "ClientProfile"
SET "phoneHash" = encode(digest(
    CASE
      WHEN regexp_replace("phone", '\D', '', 'g') ~ '^1[0-9]{10}$'
        THEN '+' || regexp_replace("phone", '\D', '', 'g')
      WHEN regexp_replace("phone", '\D', '', 'g') ~ '^[0-9]{10}$'
        THEN '+1' || regexp_replace("phone", '\D', '', 'g')
      WHEN regexp_replace("phone", '\D', '', 'g') <> ''
        THEN '+' || regexp_replace("phone", '\D', '', 'g')
      ELSE NULL
    END,
    'sha256'
  ), 'hex')
WHERE "phone" IS NOT NULL
  AND trim("phone") <> ''
  AND regexp_replace("phone", '\D', '', 'g') <> ''
  AND "phoneHash" IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "User_emailHash_key"
  ON "User"("emailHash")
  WHERE "emailHash" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "User_phoneHash_key"
  ON "User"("phoneHash")
  WHERE "phoneHash" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "ClientProfile_emailHash_key"
  ON "ClientProfile"("emailHash")
  WHERE "emailHash" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "ClientProfile_phoneHash_key"
  ON "ClientProfile"("phoneHash")
  WHERE "phoneHash" IS NOT NULL;