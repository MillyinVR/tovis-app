CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE "ProClientInvite"
  ADD COLUMN IF NOT EXISTS "tokenHash" VARCHAR(128);

UPDATE "ProClientInvite"
SET "tokenHash" = encode(digest("token", 'sha256'), 'hex')
WHERE "token" IS NOT NULL
  AND "tokenHash" IS NULL;

DROP INDEX IF EXISTS "ProClientInvite_tokenHash_idx";

CREATE UNIQUE INDEX IF NOT EXISTS "ProClientInvite_tokenHash_key"
  ON "ProClientInvite"("tokenHash");

CREATE INDEX IF NOT EXISTS "ProClientInvite_tokenHash_idx"
  ON "ProClientInvite"("tokenHash");