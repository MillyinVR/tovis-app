-- Make the consult upload ownership edge explicit for cleanup queries and
-- cascade only after the session's verified-purge delete guard has passed.
ALTER TABLE "UploadSession"
  ADD CONSTRAINT "UploadSession_consultSessionId_fkey"
  FOREIGN KEY ("consultSessionId") REFERENCES "ConsultSession"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- The first binding trigger proves ownership/path/version identity. This
-- additional guard closes the remaining direct-writer gaps that depend on the
-- upload row and current lifecycle state.
CREATE OR REPLACE FUNCTION "consult_capture_c3_contract_guard"()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NOT EXISTS (
    SELECT 1 FROM public."UploadSession"
    WHERE "id" = NEW."uploadSessionId"
      AND "maxBytes" = NEW."sizeBytes"
      AND "checksumSha256" IS NOT DISTINCT FROM NEW."checksumSha256"
  ) THEN
    RAISE EXCEPTION 'capture size and checksum must match the minted upload'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'UPDATE'
    AND OLD."status" = 'ATTACHED'
    AND NEW."status" IN ('ACCEPTED', 'REJECTED')
    AND NOT EXISTS (
      SELECT 1 FROM public."ConsultSession"
      WHERE "id" = NEW."consultSessionId" AND "status" = 'MEDIA_READY'
    )
  THEN
    RAISE EXCEPTION 'capture quality requires the media-ready lifecycle state'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
ALTER FUNCTION "consult_capture_c3_contract_guard"() SET search_path = '';

CREATE TRIGGER "ConsultCapture_c3_contract_guard"
  BEFORE INSERT OR UPDATE ON "ConsultCapture"
  FOR EACH ROW EXECUTE FUNCTION "consult_capture_c3_contract_guard"();

-- C3 audits contain identifiers and bounded lifecycle facts only. In
-- particular, raw purge evidence cannot be coupled to revision/legal/status
-- payload fields by a direct writer.
ALTER TABLE "ConsultAuditEvent" DROP CONSTRAINT "ConsultAuditEvent_shape";
ALTER TABLE "ConsultAuditEvent"
  ADD CONSTRAINT "ConsultAuditEvent_shape" CHECK (
    ("action" = 'SESSION_CREATED' AND "fromStatus" IS NULL AND "toStatus" IS NOT NULL)
    OR ("action" = 'AGREEMENT_ACCEPTED' AND "agreementAcceptanceId" IS NOT NULL)
    OR ("action" = 'AGREEMENT_REVOKED' AND "agreementAcceptanceId" IS NOT NULL)
    OR ("action" = 'LIFECYCLE_TRANSITIONED' AND "fromStatus" IS NOT NULL AND "toStatus" IS NOT NULL)
    OR ("action" = 'REVISION_CREATED' AND "revisionId" IS NOT NULL)
    OR ("action" = 'CAPTURE_UPLOAD_ISSUED'
      AND "captureId" IS NULL AND "agreementAcceptanceId" IS NULL
      AND "revisionId" IS NULL AND "fromStatus" IS NULL AND "toStatus" IS NULL)
    OR ("action" IN ('CAPTURE_ATTACHED', 'CAPTURE_QUALITY_CHECKED', 'CAPTURE_DELETED')
      AND "captureId" IS NOT NULL AND "agreementAcceptanceId" IS NULL
      AND "revisionId" IS NULL AND "fromStatus" IS NULL AND "toStatus" IS NULL)
    OR ("action" = 'RAW_OBJECT_PURGED'
      AND "agreementAcceptanceId" IS NULL AND "revisionId" IS NULL
      AND "fromStatus" IS NULL AND "toStatus" IS NULL)
  );
