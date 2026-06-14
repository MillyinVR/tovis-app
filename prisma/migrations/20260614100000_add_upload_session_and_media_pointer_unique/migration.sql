-- UploadSession: bind a server-minted signed-upload URL to the MediaAsset it
-- produces (finish-plan T2.1 / Phase 4), plus a one-row-per-object unique index
-- on MediaAsset's storage pointer.
--
-- Written in the idempotent raw-SQL style (see
-- 20260613120000_add_media_notification_tenant_attribution) so manual reruns /
-- manual prod application are safe.
--
-- The MediaAsset unique index is safe to add: production was verified to hold
-- 0 duplicate (storageBucket, storagePath) groups before this migration.

-- Enums ---------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'UploadSurface') THEN
    CREATE TYPE "UploadSurface" AS ENUM (
      'PRO_BOOKING_MEDIA',
      'PRO_LOOKS',
      'PRO_PORTFOLIO',
      'CLIENT_REVIEW'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'UploadSessionStatus') THEN
    CREATE TYPE "UploadSessionStatus" AS ENUM (
      'PENDING',
      'CONSUMED',
      'EXPIRED'
    );
  END IF;
END
$$;

-- UploadSession -------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "UploadSession" (
  "id"             TEXT NOT NULL,
  "surface"        "UploadSurface" NOT NULL,
  "status"         "UploadSessionStatus" NOT NULL DEFAULT 'PENDING',
  "tenantId"       TEXT,
  "professionalId" TEXT,
  "clientId"       TEXT,
  "bookingId"      TEXT,
  "phase"          "MediaPhase",
  "storageBucket"  TEXT NOT NULL,
  "storagePath"    TEXT NOT NULL,
  "contentType"    TEXT NOT NULL,
  "maxBytes"       INTEGER NOT NULL,
  "checksumSha256" TEXT,
  "expiresAt"      TIMESTAMP(3) NOT NULL,
  "consumedAt"     TIMESTAMP(3),
  "mediaAssetId"   TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "UploadSession_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "UploadSession_storageBucket_storagePath_key"
  ON "UploadSession"("storageBucket", "storagePath");
CREATE INDEX IF NOT EXISTS "UploadSession_status_expiresAt_idx"
  ON "UploadSession"("status", "expiresAt");
CREATE INDEX IF NOT EXISTS "UploadSession_professionalId_idx"
  ON "UploadSession"("professionalId");
CREATE INDEX IF NOT EXISTS "UploadSession_clientId_idx"
  ON "UploadSession"("clientId");
CREATE INDEX IF NOT EXISTS "UploadSession_bookingId_idx"
  ON "UploadSession"("bookingId");

-- MediaAsset: one row per stored object --------------------------------------

CREATE UNIQUE INDEX IF NOT EXISTS "MediaAsset_storageBucket_storagePath_key"
  ON "MediaAsset"("storageBucket", "storagePath");
