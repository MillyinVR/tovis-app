-- Close direct-writer gaps at transaction commit: a capture and its consumed
-- upload must exist together, bounded quality provenance is exact, and C4 may
-- only be queued after the complete accepted C3 pack exists.

ALTER TABLE "ConsultCapture"
  ADD CONSTRAINT "ConsultCapture_quality_contract" CHECK (
    "status" = 'ATTACHED'
    OR (
      "qualityPromptVersion" = 'hair-color-capture-v1'
      AND "qualitySchemaVersion" = 1
      AND (
        ("status" = 'ACCEPTED' AND "qualityReasonCode" = 'PASS' AND "retakeTip" IS NULL)
        OR
        ("status" = 'REJECTED' AND "qualityReasonCode" IN (
          'WARM_INDOOR_LIGHT',
          'COLOR_CAST',
          'VIEW_MISMATCH',
          'HAIR_NOT_VISIBLE',
          'BLURRY',
          'TOO_DARK',
          'TOO_BRIGHT',
          'OTHER_QUALITY_FAILURE'
        ))
      )
    )
  );

CREATE OR REPLACE FUNCTION "consult_upload_consumed_requires_capture"()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."surface" = 'CLIENT_CONSULT' AND NEW."status" = 'CONSUMED'
    AND NOT EXISTS (
      SELECT 1 FROM public."ConsultCapture"
      WHERE "uploadSessionId" = NEW."id"
        AND "consultSessionId" = NEW."consultSessionId"
        AND "shotKey" = NEW."consultShotKey"
    )
  THEN
    RAISE EXCEPTION 'consumed consult upload requires its exact capture binding'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
ALTER FUNCTION "consult_upload_consumed_requires_capture"() SET search_path = '';

CREATE CONSTRAINT TRIGGER "UploadSession_consumed_requires_capture"
  AFTER INSERT OR UPDATE ON "UploadSession"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "consult_upload_consumed_requires_capture"();

CREATE OR REPLACE FUNCTION "consult_capture_requires_consumed_upload"()
RETURNS TRIGGER AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public."UploadSession"
    WHERE "id" = NEW."uploadSessionId"
      AND "surface" = 'CLIENT_CONSULT'
      AND "status" = 'CONSUMED'
      AND "consultSessionId" = NEW."consultSessionId"
      AND "consultShotKey" = NEW."shotKey"
  )
  THEN
    RAISE EXCEPTION 'consult capture requires its consumed exact upload binding'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
ALTER FUNCTION "consult_capture_requires_consumed_upload"() SET search_path = '';

CREATE CONSTRAINT TRIGGER "ConsultCapture_requires_consumed_upload"
  AFTER INSERT ON "ConsultCapture"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "consult_capture_requires_consumed_upload"();

CREATE OR REPLACE FUNCTION "consult_lifecycle_guard"()
RETURNS TRIGGER AS $$
DECLARE
  allowed BOOLEAN;
  accepted_slot_count INTEGER;
BEGIN
  IF NEW."status" = OLD."status" THEN
    RETURN NEW;
  END IF;

  allowed := CASE OLD."status"
    WHEN 'CONSENT_REQUIRED' THEN NEW."status" IN ('INTAKE_READY', 'CANCELLED')
    WHEN 'INTAKE_READY' THEN NEW."status" IN ('INTAKE_IN_PROGRESS', 'CONSENT_REVOKED', 'CANCELLED')
    WHEN 'INTAKE_IN_PROGRESS' THEN NEW."status" IN ('MEDIA_READY', 'CONSENT_REVOKED', 'CANCELLED')
    WHEN 'MEDIA_READY' THEN NEW."status" IN ('ANALYSIS_PENDING', 'CONSENT_REVOKED', 'CANCELLED')
    WHEN 'ANALYSIS_PENDING' THEN NEW."status" IN ('ANALYZING', 'CONSENT_REVOKED', 'CANCELLED')
    WHEN 'ANALYZING' THEN NEW."status" IN ('ANALYSIS_PENDING', 'COMPLETED', 'CONSENT_REVOKED', 'CANCELLED')
    WHEN 'COMPLETED' THEN NEW."status" = 'CONSENT_REVOKED'
    WHEN 'CONSENT_REVOKED' THEN NEW."status" IN ('CONSENT_REQUIRED', 'CANCELLED')
    WHEN 'CANCELLED' THEN FALSE
  END;

  IF NOT allowed THEN
    RAISE EXCEPTION 'invalid consult lifecycle transition: % -> %', OLD."status", NEW."status"
      USING ERRCODE = '23514';
  END IF;

  IF NEW."status" IN (
    'INTAKE_READY', 'INTAKE_IN_PROGRESS', 'MEDIA_READY',
    'ANALYSIS_PENDING', 'ANALYZING', 'COMPLETED'
  ) AND NOT public."consult_current_agreements_active"(NEW."id") THEN
    RAISE EXCEPTION 'current consent and 18+ attestation are required for lifecycle transition'
      USING ERRCODE = '23514';
  END IF;

  IF OLD."status" = 'MEDIA_READY' AND NEW."status" = 'ANALYSIS_PENDING' THEN
    SELECT count(DISTINCT "shotKey")
    INTO accepted_slot_count
    FROM public."ConsultCapture"
    WHERE "consultSessionId" = NEW."id"
      AND "status" = 'ACCEPTED'
      AND "purgedAt" IS NULL
      AND "rawExpiresAt" > CURRENT_TIMESTAMP;

    IF accepted_slot_count <> 4 THEN
      RAISE EXCEPTION 'analysis requires the complete accepted unexpired capture pack'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
ALTER FUNCTION "consult_lifecycle_guard"() SET search_path = '';
