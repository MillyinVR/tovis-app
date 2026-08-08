-- AI Consult Phase 0 C3: consent-gated, private, expiring hair-color capture;
-- bounded quality results; and verified raw-object purge metadata.
-- No legal wording, MediaAsset, permanent ConsultPhoto, analysis, UI, brows,
-- or standalone consult scope is introduced here.

CREATE TYPE "ConsultCaptureStatus" AS ENUM ('ATTACHED', 'ACCEPTED', 'REJECTED');

ALTER TABLE "UploadSession"
  ADD COLUMN "consultSessionId" TEXT,
  ADD COLUMN "serviceCategoryId" TEXT,
  ADD COLUMN "consultShotKey" VARCHAR(64),
  ADD COLUMN "shotPackVersion" INTEGER,
  ADD COLUMN "captureSchemaVersion" INTEGER,
  ADD COLUMN "idempotencyKey" VARCHAR(128),
  ADD COLUMN "requestHash" CHAR(64),
  ADD COLUMN "rawExpiresAt" TIMESTAMP(3),
  ADD COLUMN "purgeEligibleAt" TIMESTAMP(3),
  ADD COLUMN "purgedAt" TIMESTAMP(3),
  ADD CONSTRAINT "UploadSession_consult_shape" CHECK (
    (
      "surface" <> 'CLIENT_CONSULT'
      AND "consultSessionId" IS NULL
      AND "serviceCategoryId" IS NULL
      AND "consultShotKey" IS NULL
      AND "shotPackVersion" IS NULL
      AND "captureSchemaVersion" IS NULL
      AND "idempotencyKey" IS NULL
      AND "requestHash" IS NULL
      AND "rawExpiresAt" IS NULL
      AND "purgeEligibleAt" IS NULL
      AND "purgedAt" IS NULL
    ) OR (
      "surface" = 'CLIENT_CONSULT'
      AND "consultSessionId" IS NOT NULL
      AND "clientId" IS NOT NULL
      AND "professionalId" IS NOT NULL
      AND "bookingId" IS NOT NULL
      AND "serviceCategoryId" IS NOT NULL
      AND "consultShotKey" IN ('hair_back', 'hair_left', 'hair_right', 'hair_crown')
      AND "shotPackVersion" = 1
      AND "captureSchemaVersion" = 1
      AND length(btrim("idempotencyKey")) BETWEEN 1 AND 128
      AND "idempotencyKey" = btrim("idempotencyKey")
      AND "requestHash" ~ '^[0-9a-f]{64}$'
      AND "rawExpiresAt" > "expiresAt"
      AND "rawExpiresAt" <= "createdAt" + INTERVAL '24 hours'
      AND "contentType" IN ('image/jpeg', 'image/png', 'image/webp')
      AND "maxBytes" BETWEEN 1 AND 5000000
      AND ("checksumSha256" IS NULL OR "checksumSha256" ~ '^[0-9a-f]{64}$')
      AND (
        ("purgedAt" IS NULL AND "storageBucket" = 'media-private'
          AND "storagePath" ~ '^consult-raw/v1/[0-9a-f-]{36}\.(jpg|png|webp)$')
        OR
        ("purgedAt" IS NOT NULL AND "storageBucket" = 'purged'
          AND "storagePath" = 'purged/' || "id")
      )
    )
  );

CREATE UNIQUE INDEX "UploadSession_consultSessionId_idempotencyKey_key"
  ON "UploadSession" ("consultSessionId", "idempotencyKey");
CREATE INDEX "UploadSession_surface_purgedAt_purgeEligibleAt_expiresAt_idx"
  ON "UploadSession" ("surface", "purgedAt", "purgeEligibleAt", "expiresAt");

CREATE TABLE "ConsultCapture" (
  "id" TEXT NOT NULL,
  "consultSessionId" TEXT NOT NULL,
  "uploadSessionId" TEXT NOT NULL,
  "shotKey" VARCHAR(64) NOT NULL,
  "shotPackVersion" INTEGER NOT NULL,
  "schemaVersion" INTEGER NOT NULL,
  "storageBucket" TEXT,
  "storagePath" TEXT,
  "contentType" VARCHAR(64) NOT NULL,
  "sizeBytes" INTEGER NOT NULL,
  "checksumSha256" CHAR(64),
  "status" "ConsultCaptureStatus" NOT NULL DEFAULT 'ATTACHED',
  "qualityReasonCode" VARCHAR(64),
  "retakeTip" VARCHAR(160),
  "qualitySchemaVersion" INTEGER,
  "qualityPromptVersion" VARCHAR(64),
  "qualityModel" VARCHAR(128),
  "qualityCheckedAt" TIMESTAMP(3),
  "attachIdempotencyKey" VARCHAR(128) NOT NULL,
  "attachRequestHash" CHAR(64) NOT NULL,
  "qualityIdempotencyKey" VARCHAR(128),
  "qualityRequestHash" CHAR(64),
  "rawExpiresAt" TIMESTAMP(3) NOT NULL,
  "purgeEligibleAt" TIMESTAMP(3),
  "purgeRequestedAt" TIMESTAMP(3),
  "purgedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ConsultCapture_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ConsultCapture_shape" CHECK (
    "shotKey" IN ('hair_back', 'hair_left', 'hair_right', 'hair_crown')
    AND "shotPackVersion" = 1
    AND "schemaVersion" = 1
    AND "contentType" IN ('image/jpeg', 'image/png', 'image/webp')
    AND "sizeBytes" BETWEEN 1 AND 5000000
    AND ("checksumSha256" IS NULL OR "checksumSha256" ~ '^[0-9a-f]{64}$')
    AND length(btrim("attachIdempotencyKey")) BETWEEN 1 AND 128
    AND "attachIdempotencyKey" = btrim("attachIdempotencyKey")
    AND "attachRequestHash" ~ '^[0-9a-f]{64}$'
    AND (
      ("purgedAt" IS NULL AND "storageBucket" = 'media-private' AND "storagePath" IS NOT NULL)
      OR
      ("purgedAt" IS NOT NULL AND "storageBucket" IS NULL AND "storagePath" IS NULL)
    )
    AND (
      ("status" = 'ATTACHED'
        AND "qualityReasonCode" IS NULL
        AND "retakeTip" IS NULL
        AND "qualitySchemaVersion" IS NULL
        AND "qualityPromptVersion" IS NULL
        AND "qualityModel" IS NULL
        AND "qualityCheckedAt" IS NULL
        AND "qualityIdempotencyKey" IS NULL
        AND "qualityRequestHash" IS NULL)
      OR
      ("status" IN ('ACCEPTED', 'REJECTED')
        AND "qualityReasonCode" IS NOT NULL
        AND "qualitySchemaVersion" = 1
        AND "qualityPromptVersion" IS NOT NULL
        AND "qualityModel" IS NOT NULL
        AND "qualityCheckedAt" IS NOT NULL
        AND length(btrim("qualityIdempotencyKey")) BETWEEN 1 AND 128
        AND "qualityIdempotencyKey" = btrim("qualityIdempotencyKey")
        AND "qualityRequestHash" ~ '^[0-9a-f]{64}$')
    )
    AND ("retakeTip" IS NULL OR length(btrim("retakeTip")) BETWEEN 1 AND 160)
    AND ("purgeRequestedAt" IS NULL OR "purgeEligibleAt" IS NOT NULL)
  )
);

CREATE UNIQUE INDEX "ConsultCapture_uploadSessionId_key"
  ON "ConsultCapture" ("uploadSessionId");
CREATE UNIQUE INDEX "ConsultCapture_consultSessionId_attachIdempotencyKey_key"
  ON "ConsultCapture" ("consultSessionId", "attachIdempotencyKey");
CREATE INDEX "ConsultCapture_consultSessionId_shotKey_createdAt_idx"
  ON "ConsultCapture" ("consultSessionId", "shotKey", "createdAt");
CREATE INDEX "ConsultCapture_purgedAt_purgeEligibleAt_rawExpiresAt_idx"
  ON "ConsultCapture" ("purgedAt", "purgeEligibleAt", "rawExpiresAt");
CREATE UNIQUE INDEX "ConsultCapture_one_live_accepted_slot"
  ON "ConsultCapture" ("consultSessionId", "shotKey")
  WHERE "status" = 'ACCEPTED' AND "purgedAt" IS NULL;

ALTER TABLE "ConsultCapture"
  ADD CONSTRAINT "ConsultCapture_consultSessionId_fkey"
  FOREIGN KEY ("consultSessionId") REFERENCES "ConsultSession" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ConsultAuditEvent"
  ADD COLUMN "captureId" TEXT;
CREATE INDEX "ConsultAuditEvent_captureId_idx"
  ON "ConsultAuditEvent" ("captureId");
CREATE UNIQUE INDEX "ConsultAuditEvent_captureId_action_key"
  ON "ConsultAuditEvent" ("captureId", "action");
ALTER TABLE "ConsultAuditEvent"
  ADD CONSTRAINT "ConsultAuditEvent_captureId_fkey"
  FOREIGN KEY ("captureId") REFERENCES "ConsultCapture" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ConsultAuditEvent" DROP CONSTRAINT "ConsultAuditEvent_shape";
ALTER TABLE "ConsultAuditEvent"
  ADD CONSTRAINT "ConsultAuditEvent_shape" CHECK (
    ("action" = 'SESSION_CREATED' AND "fromStatus" IS NULL AND "toStatus" IS NOT NULL)
    OR ("action" = 'AGREEMENT_ACCEPTED' AND "agreementAcceptanceId" IS NOT NULL)
    OR ("action" = 'AGREEMENT_REVOKED' AND "agreementAcceptanceId" IS NOT NULL)
    OR ("action" = 'LIFECYCLE_TRANSITIONED' AND "fromStatus" IS NOT NULL AND "toStatus" IS NOT NULL)
    OR ("action" = 'REVISION_CREATED' AND "revisionId" IS NOT NULL)
    OR ("action" = 'CAPTURE_UPLOAD_ISSUED' AND "captureId" IS NULL)
    OR ("action" IN ('CAPTURE_ATTACHED', 'CAPTURE_QUALITY_CHECKED', 'CAPTURE_DELETED') AND "captureId" IS NOT NULL)
    OR ("action" = 'RAW_OBJECT_PURGED')
  );

-- Direct CLIENT_CONSULT issuance is constrained to the same exact owner,
-- booking, category, versions, slot, legal, lifecycle, and pilot boundary as
-- the application route.
CREATE OR REPLACE FUNCTION "consult_upload_session_guard"()
RETURNS TRIGGER AS $$
DECLARE
  scope_matches BOOLEAN;
BEGIN
  IF NEW."surface" <> 'CLIENT_CONSULT' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW."consultSessionId" <> OLD."consultSessionId"
      OR NEW."clientId" <> OLD."clientId"
      OR NEW."professionalId" <> OLD."professionalId"
      OR NEW."bookingId" <> OLD."bookingId"
      OR NEW."serviceCategoryId" <> OLD."serviceCategoryId"
      OR NEW."consultShotKey" <> OLD."consultShotKey"
      OR NEW."shotPackVersion" <> OLD."shotPackVersion"
      OR NEW."captureSchemaVersion" <> OLD."captureSchemaVersion"
      OR NEW."idempotencyKey" <> OLD."idempotencyKey"
      OR NEW."requestHash" <> OLD."requestHash"
      OR NEW."contentType" <> OLD."contentType"
      OR NEW."maxBytes" <> OLD."maxBytes"
      OR NEW."checksumSha256" IS DISTINCT FROM OLD."checksumSha256"
      OR NEW."expiresAt" <> OLD."expiresAt"
      OR NEW."rawExpiresAt" <> OLD."rawExpiresAt"
    THEN
      RAISE EXCEPTION 'consult upload binding is immutable'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  SELECT
    session."clientId" = NEW."clientId"
    AND session."professionalId" = NEW."professionalId"
    AND session."bookingId" = NEW."bookingId"
    AND session."serviceCategoryId" = NEW."serviceCategoryId"
    AND session."status" = 'MEDIA_READY'
    AND booking."status" IN ('PENDING', 'ACCEPTED')
    AND booking."scheduledFor" > CURRENT_TIMESTAMP
    AND booking."scheduledFor" <= CURRENT_TIMESTAMP + INTERVAL '90 days'
    AND category."slug" = 'hair-color'
  INTO scope_matches
  FROM public."ConsultSession" AS session
  JOIN public."Booking" AS booking ON booking."id" = session."bookingId"
  JOIN public."Service" AS service ON service."id" = booking."serviceId"
  JOIN public."ServiceCategory" AS category ON category."id" = service."categoryId"
  WHERE session."id" = NEW."consultSessionId";

  IF scope_matches IS DISTINCT FROM TRUE
    OR NOT public."consult_current_agreements_active"(NEW."consultSessionId")
  THEN
    RAISE EXCEPTION 'consult upload requires current prerequisites and exact eligible scope'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
ALTER FUNCTION "consult_upload_session_guard"() SET search_path = '';

CREATE TRIGGER "UploadSession_consult_guard"
  BEFORE INSERT OR UPDATE ON "UploadSession"
  FOR EACH ROW EXECUTE FUNCTION "consult_upload_session_guard"();

CREATE OR REPLACE FUNCTION "consult_capture_guard"()
RETURNS TRIGGER AS $$
DECLARE
  binding_matches BOOLEAN;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT
      upload."surface" = 'CLIENT_CONSULT'
      AND upload."status" = 'PENDING'
      AND upload."consultSessionId" = NEW."consultSessionId"
      AND upload."consultShotKey" = NEW."shotKey"
      AND upload."shotPackVersion" = NEW."shotPackVersion"
      AND upload."captureSchemaVersion" = NEW."schemaVersion"
      AND upload."storageBucket" = NEW."storageBucket"
      AND upload."storagePath" = NEW."storagePath"
      AND upload."contentType" = NEW."contentType"
      AND upload."rawExpiresAt" = NEW."rawExpiresAt"
      AND session."status" = 'MEDIA_READY'
    INTO binding_matches
    FROM public."UploadSession" AS upload
    JOIN public."ConsultSession" AS session ON session."id" = NEW."consultSessionId"
    WHERE upload."id" = NEW."uploadSessionId";

    IF binding_matches IS DISTINCT FROM TRUE
      OR NOT public."consult_current_agreements_active"(NEW."consultSessionId")
    THEN
      RAISE EXCEPTION 'capture must match an active server-minted consult upload'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW."id" <> OLD."id"
    OR NEW."consultSessionId" <> OLD."consultSessionId"
    OR NEW."uploadSessionId" <> OLD."uploadSessionId"
    OR NEW."shotKey" <> OLD."shotKey"
    OR NEW."shotPackVersion" <> OLD."shotPackVersion"
    OR NEW."schemaVersion" <> OLD."schemaVersion"
    OR NEW."contentType" <> OLD."contentType"
    OR NEW."sizeBytes" <> OLD."sizeBytes"
    OR NEW."checksumSha256" IS DISTINCT FROM OLD."checksumSha256"
    OR NEW."attachIdempotencyKey" <> OLD."attachIdempotencyKey"
    OR NEW."attachRequestHash" <> OLD."attachRequestHash"
    OR NEW."rawExpiresAt" <> OLD."rawExpiresAt"
  THEN
    RAISE EXCEPTION 'capture binding is immutable' USING ERRCODE = '23514';
  END IF;

  IF OLD."status" <> 'ATTACHED' AND NEW."status" <> OLD."status" THEN
    RAISE EXCEPTION 'capture quality decision is immutable' USING ERRCODE = '23514';
  END IF;
  IF OLD."qualityCheckedAt" IS NOT NULL AND (
    NEW."qualityReasonCode" IS DISTINCT FROM OLD."qualityReasonCode"
    OR NEW."retakeTip" IS DISTINCT FROM OLD."retakeTip"
    OR NEW."qualitySchemaVersion" IS DISTINCT FROM OLD."qualitySchemaVersion"
    OR NEW."qualityPromptVersion" IS DISTINCT FROM OLD."qualityPromptVersion"
    OR NEW."qualityModel" IS DISTINCT FROM OLD."qualityModel"
    OR NEW."qualityCheckedAt" IS DISTINCT FROM OLD."qualityCheckedAt"
    OR NEW."qualityIdempotencyKey" IS DISTINCT FROM OLD."qualityIdempotencyKey"
    OR NEW."qualityRequestHash" IS DISTINCT FROM OLD."qualityRequestHash"
  ) THEN
    RAISE EXCEPTION 'capture quality evidence is immutable' USING ERRCODE = '23514';
  END IF;
  IF OLD."purgedAt" IS NOT NULL AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'purged capture evidence is immutable' USING ERRCODE = '23514';
  END IF;
  IF OLD."status" = 'ATTACHED' AND NEW."status" IN ('ACCEPTED', 'REJECTED')
    AND NOT public."consult_current_agreements_active"(NEW."consultSessionId")
  THEN
    RAISE EXCEPTION 'current prerequisites are required to finalize capture quality'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
ALTER FUNCTION "consult_capture_guard"() SET search_path = '';

CREATE TRIGGER "ConsultCapture_guard"
  BEFORE INSERT OR UPDATE ON "ConsultCapture"
  FOR EACH ROW EXECUTE FUNCTION "consult_capture_guard"();

-- Revocation/cancellation immediately makes every raw object eligible. This
-- is also enforced for direct database writes, independently of app routes.
CREATE OR REPLACE FUNCTION "consult_raw_purge_fence"()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."status" IN ('CONSENT_REVOKED', 'CANCELLED') AND NEW."status" <> OLD."status" THEN
    UPDATE public."UploadSession"
    SET "purgeEligibleAt" = CURRENT_TIMESTAMP
    WHERE "surface" = 'CLIENT_CONSULT'
      AND "consultSessionId" = NEW."id"
      AND "purgedAt" IS NULL;
    UPDATE public."ConsultCapture"
    SET "purgeEligibleAt" = CURRENT_TIMESTAMP, "purgeRequestedAt" = CURRENT_TIMESTAMP
    WHERE "consultSessionId" = NEW."id" AND "purgedAt" IS NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
ALTER FUNCTION "consult_raw_purge_fence"() SET search_path = '';

CREATE TRIGGER "ConsultSession_raw_purge_fence"
  AFTER UPDATE OF "status" ON "ConsultSession"
  FOR EACH ROW EXECUTE FUNCTION "consult_raw_purge_fence"();

CREATE OR REPLACE FUNCTION "consult_session_delete_requires_purge"()
RETURNS TRIGGER AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public."ConsultCapture"
    WHERE "consultSessionId" = OLD."id" AND "purgedAt" IS NULL
  ) OR EXISTS (
    SELECT 1 FROM public."UploadSession"
    WHERE "surface" = 'CLIENT_CONSULT'
      AND "consultSessionId" = OLD."id"
      AND "purgedAt" IS NULL
  ) THEN
    RAISE EXCEPTION 'raw consult objects must be verified purged before session deletion'
      USING ERRCODE = '23514';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;
ALTER FUNCTION "consult_session_delete_requires_purge"() SET search_path = '';

CREATE TRIGGER "ConsultSession_delete_requires_purge"
  BEFORE DELETE ON "ConsultSession"
  FOR EACH ROW EXECUTE FUNCTION "consult_session_delete_requires_purge"();

ALTER TABLE "ConsultCapture" ENABLE ROW LEVEL SECURITY;
