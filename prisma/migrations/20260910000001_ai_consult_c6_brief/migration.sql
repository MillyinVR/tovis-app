-- AI Consult Phase 0 C6: deterministic pro brief, consult-attributed bookings,
-- immutable one-tap pro feedback, and a quiet-hours-aware invitation event.
-- C6 exposure remains blocked in application code until C5's approved live
-- baseline and candidate exist. Enum expansion commits in the prior migration
-- before the feedback action is referenced by constraints below.

CREATE TYPE "ConsultBriefFeedbackRating" AS ENUM ('ACCURATE_USEFUL', 'OFF');

ALTER TABLE "Booking" ADD COLUMN "sourceConsultSessionId" TEXT;
CREATE INDEX "Booking_sourceConsultSessionId_idx"
  ON "Booking" ("sourceConsultSessionId");
ALTER TABLE "Booking"
  ADD CONSTRAINT "Booking_sourceConsultSessionId_fkey"
  FOREIGN KEY ("sourceConsultSessionId") REFERENCES "ConsultSession" ("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "ConsultBriefFeedback" (
  "id" TEXT NOT NULL,
  "consultSessionId" TEXT NOT NULL,
  "briefRevisionId" TEXT NOT NULL,
  "professionalId" TEXT NOT NULL,
  "rating" "ConsultBriefFeedbackRating" NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ConsultBriefFeedback_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ConsultBriefFeedback_consultSessionId_key"
  ON "ConsultBriefFeedback" ("consultSessionId");
CREATE UNIQUE INDEX "ConsultBriefFeedback_briefRevisionId_key"
  ON "ConsultBriefFeedback" ("briefRevisionId");
CREATE INDEX "ConsultBriefFeedback_professionalId_createdAt_idx"
  ON "ConsultBriefFeedback" ("professionalId", "createdAt");

ALTER TABLE "ConsultBriefFeedback"
  ADD CONSTRAINT "ConsultBriefFeedback_consultSessionId_fkey"
  FOREIGN KEY ("consultSessionId") REFERENCES "ConsultSession" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ConsultBriefFeedback"
  ADD CONSTRAINT "ConsultBriefFeedback_briefRevisionId_fkey"
  FOREIGN KEY ("briefRevisionId") REFERENCES "ConsultRevision" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ConsultBriefFeedback"
  ADD CONSTRAINT "ConsultBriefFeedback_professionalId_fkey"
  FOREIGN KEY ("professionalId") REFERENCES "ProfessionalProfile" ("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ConsultAuditEvent" ADD COLUMN "briefFeedbackId" TEXT;
CREATE UNIQUE INDEX "ConsultAuditEvent_briefFeedbackId_key"
  ON "ConsultAuditEvent" ("briefFeedbackId");
ALTER TABLE "ConsultAuditEvent"
  ADD CONSTRAINT "ConsultAuditEvent_briefFeedbackId_fkey"
  FOREIGN KEY ("briefFeedbackId") REFERENCES "ConsultBriefFeedback" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- One generated brief per immutable source analysis. A future appended analysis
-- can generate a new brief without rewriting history.
CREATE UNIQUE INDEX "ConsultRevision_one_brief_per_analysis"
  ON "ConsultRevision" (
    "consultSessionId",
    (("payload" ->> 'sourceAnalysisRevisionId'))
  )
  WHERE "kind" = 'BRIEF';

CREATE OR REPLACE FUNCTION "consult_brief_payload_guard"()
RETURNS TRIGGER AS $$
DECLARE
  latest_analysis_id TEXT;
  latest_intake_id TEXT;
BEGIN
  IF NEW."kind" <> 'BRIEF' THEN RETURN NEW; END IF;

  SELECT "id" INTO latest_analysis_id
  FROM public."ConsultRevision"
  WHERE "consultSessionId" = NEW."consultSessionId" AND "kind" = 'ANALYSIS'
  ORDER BY "revision" DESC
  LIMIT 1;

  SELECT "id" INTO latest_intake_id
  FROM public."ConsultRevision"
  WHERE "consultSessionId" = NEW."consultSessionId" AND "kind" = 'INTAKE'
  ORDER BY "revision" DESC
  LIMIT 1;

  IF NEW."schemaVersion" <> 1
    OR NEW."model" IS NOT NULL
    OR NEW."promptVersion" IS DISTINCT FROM 'hair-color-pro-brief-v1'
    OR jsonb_typeof(NEW."payload") IS DISTINCT FROM 'object'
    OR NOT NEW."payload" ?& ARRAY[
      'schemaVersion', 'sourceAnalysisRevisionId', 'sourceAnalysisRevision',
      'intakeRevisionId', 'clientIntake', 'aiObservations', 'safetyFlags',
      'achievabilityDirection', 'recommendationDirections'
    ]
    OR NEW."payload" - ARRAY[
      'schemaVersion', 'sourceAnalysisRevisionId', 'sourceAnalysisRevision',
      'intakeRevisionId', 'clientIntake', 'aiObservations', 'safetyFlags',
      'achievabilityDirection', 'recommendationDirections'
    ] <> '{}'::jsonb
    OR NEW."payload" -> 'schemaVersion' <> '1'::jsonb
    OR NEW."payload" ->> 'sourceAnalysisRevisionId' IS DISTINCT FROM latest_analysis_id
    OR NEW."payload" ->> 'intakeRevisionId' IS DISTINCT FROM latest_intake_id
    OR jsonb_typeof(NEW."payload" -> 'clientIntake') IS DISTINCT FROM 'array'
    OR jsonb_array_length(NEW."payload" -> 'clientIntake') NOT BETWEEN 1 AND 9
    OR jsonb_typeof(NEW."payload" -> 'aiObservations') IS DISTINCT FROM 'object'
    OR jsonb_typeof(NEW."payload" -> 'safetyFlags') IS DISTINCT FROM 'array'
    OR jsonb_typeof(NEW."payload" -> 'recommendationDirections') IS DISTINCT FROM 'array'
    OR jsonb_array_length(NEW."payload" -> 'recommendationDirections') NOT BETWEEN 1 AND 3
    OR NEW."payload" #> '{achievabilityDirection,discussWithProfessional}' IS DISTINCT FROM 'true'::jsonb
    OR EXISTS (
      SELECT 1
      FROM jsonb_array_elements(NEW."payload" -> 'safetyFlags') AS flag
      WHERE flag -> 'discussWithProfessional' IS DISTINCT FROM 'true'::jsonb
    )
    OR EXISTS (
      SELECT 1
      FROM jsonb_array_elements(NEW."payload" -> 'recommendationDirections') AS recommendation
      WHERE recommendation -> 'discussWithProfessional' IS DISTINCT FROM 'true'::jsonb
    )
    -- Durable briefs may never acquire C3 object material, provider dumps, or
    -- unsupported-trait fields, even through a direct SQL writer.
    OR NEW."payload"::text ~* '"(base64|bytes|signedUrl|token|storagePath|storageBucket|rawPath|providerRequest|providerResponse|hiddenReasoning|skinTone|undertone|faceShape|eyeShape|identity|ethnicity|health)"[[:space:]]*:'
  THEN
    RAISE EXCEPTION 'invalid versioned hair-color pro brief payload'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
ALTER FUNCTION "consult_brief_payload_guard"() SET search_path = '';

CREATE TRIGGER "ConsultRevision_brief_payload_guard"
  BEFORE INSERT ON "ConsultRevision"
  FOR EACH ROW EXECUTE FUNCTION "consult_brief_payload_guard"();

CREATE OR REPLACE FUNCTION "consult_brief_feedback_guard"()
RETURNS TRIGGER AS $$
DECLARE
  session_professional_id TEXT;
  session_status public."ConsultSessionStatus";
  revision_session_id TEXT;
  revision_kind public."ConsultRevisionKind";
BEGIN
  SELECT "professionalId", "status"
    INTO session_professional_id, session_status
  FROM public."ConsultSession"
  WHERE "id" = NEW."consultSessionId";

  SELECT "consultSessionId", "kind"
    INTO revision_session_id, revision_kind
  FROM public."ConsultRevision"
  WHERE "id" = NEW."briefRevisionId";

  IF session_status <> 'COMPLETED'
    OR NEW."professionalId" IS DISTINCT FROM session_professional_id
    OR revision_session_id IS DISTINCT FROM NEW."consultSessionId"
    OR revision_kind <> 'BRIEF'
  THEN
    RAISE EXCEPTION 'invalid consult brief feedback scope'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
ALTER FUNCTION "consult_brief_feedback_guard"() SET search_path = '';

CREATE TRIGGER "ConsultBriefFeedback_scope_guard"
  BEFORE INSERT ON "ConsultBriefFeedback"
  FOR EACH ROW EXECUTE FUNCTION "consult_brief_feedback_guard"();
CREATE TRIGGER "ConsultBriefFeedback_immutable"
  BEFORE UPDATE ON "ConsultBriefFeedback"
  FOR EACH ROW EXECUTE FUNCTION "consult_immutable_row"();

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
    OR ("action" = 'BRIEF_FEEDBACK_RECORDED'
      AND "briefFeedbackId" IS NOT NULL AND "agreementAcceptanceId" IS NULL
      AND "revisionId" IS NULL AND "captureId" IS NULL
      AND "fromStatus" IS NULL AND "toStatus" IS NULL)
  );

CREATE OR REPLACE FUNCTION "consult_brief_revision_requires_audit"()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."kind" = 'BRIEF' AND NOT EXISTS (
    SELECT 1 FROM public."ConsultAuditEvent"
    WHERE "revisionId" = NEW."id"
      AND "consultSessionId" = NEW."consultSessionId"
      AND "action" = 'REVISION_CREATED'
  ) THEN
    RAISE EXCEPTION 'brief revision requires atomic content-free audit evidence'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
ALTER FUNCTION "consult_brief_revision_requires_audit"() SET search_path = '';

CREATE CONSTRAINT TRIGGER "ConsultRevision_brief_requires_audit"
  AFTER INSERT ON "ConsultRevision"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "consult_brief_revision_requires_audit"();

CREATE OR REPLACE FUNCTION "consult_brief_feedback_requires_audit"()
RETURNS TRIGGER AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public."ConsultAuditEvent"
    WHERE "briefFeedbackId" = NEW."id"
      AND "consultSessionId" = NEW."consultSessionId"
      AND "action" = 'BRIEF_FEEDBACK_RECORDED'
      AND "actorType" = 'PROFESSIONAL'
      AND "actorId" = NEW."professionalId"
  ) THEN
    RAISE EXCEPTION 'brief feedback requires atomic content-free audit evidence'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
ALTER FUNCTION "consult_brief_feedback_requires_audit"() SET search_path = '';

CREATE CONSTRAINT TRIGGER "ConsultBriefFeedback_requires_audit"
  AFTER INSERT ON "ConsultBriefFeedback"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "consult_brief_feedback_requires_audit"();

ALTER TABLE "ConsultBriefFeedback" ENABLE ROW LEVEL SECURITY;
