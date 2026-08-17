-- Public SMS/email link shortener. The `destinationPath` is always a
-- site-root-relative internal path drawn from a fixed allowlist
-- (lib/shortLink/allowlist.ts), never a full URL, so this table can never
-- become an open redirect no matter what writes a row.
--
-- Additive only — one new table, nothing existing changes shape.

CREATE TABLE "ShortLink" (
    "id" TEXT NOT NULL,
    "code" VARCHAR(16) NOT NULL,
    "destinationPath" VARCHAR(512) NOT NULL,
    "createdForType" VARCHAR(64) NOT NULL,
    "createdForId" VARCHAR(128),
    "expiresAt" TIMESTAMP(3),
    "clickCount" INTEGER NOT NULL DEFAULT 0,
    "lastClickedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShortLink_pkey" PRIMARY KEY ("id")
);

-- The public lookup path: resolve a tapped code to its destination.
CREATE UNIQUE INDEX "ShortLink_code_key" ON "ShortLink"("code");

-- Idempotent reuse: a retried delivery attempt for the same notification
-- dispatch reuses the SAME short code instead of minting a new one.
CREATE UNIQUE INDEX "ShortLink_createdForType_createdForId_key"
  ON "ShortLink"("createdForType", "createdForId");

-- The expiry sweep / early-refuse check on resolve.
CREATE INDEX "ShortLink_expiresAt_idx" ON "ShortLink"("expiresAt");

-- Deny-all lock (no policies), matching every other app table since
-- 20260901000000_enable_rls_and_pin_function_search_path — only the
-- bypassing service role (this app's own Prisma connection) can read/write.
ALTER TABLE "ShortLink" ENABLE ROW LEVEL SECURITY;
