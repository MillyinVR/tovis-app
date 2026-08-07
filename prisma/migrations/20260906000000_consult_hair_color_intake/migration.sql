-- AI Consult Phase 0 C2: booking-attached hair-color intake contract.
-- No legal wording, media, analysis, UI, standalone consult, or brow scope.

ALTER TABLE "ConsultRevision"
  ADD COLUMN "idempotencyKey" VARCHAR(128),
  ADD COLUMN "requestHash" CHAR(64),
  ADD CONSTRAINT "ConsultRevision_idempotency_shape" CHECK (
    (
      "kind" <> 'INTAKE'
      AND "idempotencyKey" IS NULL
      AND "requestHash" IS NULL
    )
    OR
    (
      "kind" = 'INTAKE'
      AND "idempotencyKey" IS NOT NULL
      AND "requestHash" IS NOT NULL
      AND btrim("idempotencyKey") = "idempotencyKey"
      AND length(btrim("idempotencyKey")) BETWEEN 1 AND 128
      AND "requestHash" ~ '^[0-9a-f]{64}$'
    )
  );

CREATE UNIQUE INDEX "ConsultRevision_consultSessionId_idempotencyKey_key"
  ON "ConsultRevision" ("consultSessionId", "idempotencyKey");

-- Every direct intake insert must use the currently supported, normalized C2
-- payload. Future pack versions extend this function; old immutable rows stay
-- valid because this trigger runs on INSERT only.
CREATE OR REPLACE FUNCTION "consult_intake_payload_guard"()
RETURNS TRIGGER AS $$
DECLARE
  answers JSONB;
BEGIN
  IF NEW."kind" <> 'INTAKE' THEN
    RETURN NEW;
  END IF;

  IF jsonb_typeof(NEW."payload") IS DISTINCT FROM 'object'
    OR NEW."payload" - ARRAY[
      'packId', 'packVersion', 'schemaVersion', 'complete', 'answers'
    ] <> '{}'::jsonb
    OR NEW."payload" ->> 'packId' IS DISTINCT FROM 'hair-color'
    OR NEW."payload" -> 'packVersion' IS DISTINCT FROM '1'::jsonb
    OR NEW."payload" -> 'schemaVersion' IS DISTINCT FROM '1'::jsonb
    OR NEW."schemaVersion" <> 1
    OR NEW."payload" -> 'schemaVersion' IS DISTINCT FROM to_jsonb(NEW."schemaVersion")
    OR jsonb_typeof(NEW."payload" -> 'complete') IS DISTINCT FROM 'boolean'
    OR jsonb_typeof(NEW."payload" -> 'answers') IS DISTINCT FROM 'object'
    OR NEW."model" IS NOT NULL
    OR NEW."promptVersion" IS NOT NULL
  THEN
    RAISE EXCEPTION 'invalid hair-color intake payload version or shape'
      USING ERRCODE = '23514';
  END IF;

  answers := NEW."payload" -> 'answers';
  IF answers = '{}'::jsonb
    OR answers - ARRAY[
      'current_color', 'desired_color', 'change_scale', 'box_dye_history',
      'prior_lightening', 'last_color_service_timing', 'prior_reaction',
      'event_timing', 'budget'
    ] <> '{}'::jsonb
    OR EXISTS (
      SELECT 1
      FROM jsonb_each(answers) AS answer
      WHERE jsonb_typeof(answer.value) <> 'string'
    )
    OR (
      answers ? 'current_color'
      AND answers ->> 'current_color' NOT IN ('blonde', 'brunette', 'black', 'red', 'gray', 'other')
    )
    OR (
      answers ? 'desired_color'
      AND answers ->> 'desired_color' NOT IN ('blonde', 'brunette', 'black', 'red', 'fantasy', 'not-sure')
    )
    OR (
      answers ? 'change_scale'
      AND answers ->> 'change_scale' NOT IN ('subtle', 'noticeable', 'total')
    )
    OR (
      answers ? 'box_dye_history'
      AND answers ->> 'box_dye_history' NOT IN ('never', 'within-6-months', '6-12-months', 'over-12-months', 'not-sure')
    )
    OR (
      answers ? 'prior_lightening'
      AND answers ->> 'prior_lightening' NOT IN ('never', 'within-3-months', '3-6-months', '6-12-months', 'over-12-months', 'not-sure')
    )
    OR (
      answers ? 'last_color_service_timing'
      AND answers ->> 'last_color_service_timing' NOT IN ('never', 'within-4-weeks', '1-3-months', '4-6-months', '7-12-months', 'over-12-months', 'not-sure')
    )
    OR (
      answers ? 'prior_reaction'
      AND answers ->> 'prior_reaction' NOT IN ('no', 'yes', 'not-sure')
    )
    OR (
      answers ? 'event_timing'
      AND answers ->> 'event_timing' NOT IN ('no-deadline', 'within-2-weeks', '2-4-weeks', '1-3-months', 'over-3-months')
    )
    OR (
      answers ? 'budget'
      AND answers ->> 'budget' NOT IN ('under-150', '150-250', '251-400', 'over-400', 'discuss-with-pro')
    )
  THEN
    RAISE EXCEPTION 'invalid hair-color intake answers'
      USING ERRCODE = '23514';
  END IF;

  IF (NEW."payload" ->> 'complete')::boolean
    AND NOT (
      answers ?& ARRAY[
        'current_color', 'desired_color', 'change_scale', 'box_dye_history',
        'prior_lightening', 'last_color_service_timing', 'prior_reaction'
      ]
    )
  THEN
    RAISE EXCEPTION 'complete hair-color intake is missing required answers'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
ALTER FUNCTION "consult_intake_payload_guard"() SET search_path = '';

CREATE TRIGGER "ConsultRevision_intake_payload_guard"
  BEFORE INSERT ON "ConsultRevision"
  FOR EACH ROW EXECUTE FUNCTION "consult_intake_payload_guard"();

-- Strengthen C1's prerequisite trigger: active evidence must point to the
-- highest currently published version for each kind, not merely have two rows.
CREATE OR REPLACE FUNCTION "consult_current_agreements_active"(consult_session_id TEXT)
RETURNS BOOLEAN AS $$
  WITH required AS (
    SELECT DISTINCT ON (version."kind") version."id", version."kind"
    FROM public."ConsultAgreementVersion" AS version
    WHERE version."publishedAt" <= CURRENT_TIMESTAMP
    ORDER BY version."kind", version."version" DESC
  ), current_evidence AS (
    SELECT required."kind"
    FROM required
    JOIN public."ConsultAgreementAcceptance" AS acceptance
      ON acceptance."agreementVersionId" = required."id"
     AND acceptance."kind" = required."kind"
     AND acceptance."consultSessionId" = consult_session_id
     AND acceptance."revokedAt" IS NULL
  )
  SELECT
    (SELECT count(*) FROM required) = 2
    AND (SELECT count(*) FROM current_evidence) = 2;
$$ LANGUAGE sql STABLE;
ALTER FUNCTION "consult_current_agreements_active"(TEXT) SET search_path = '';

CREATE OR REPLACE FUNCTION "consult_revision_requires_agreements"()
RETURNS TRIGGER AS $$
DECLARE
  session_status public."ConsultSessionStatus";
  session_sequence INTEGER;
  booking_status public."BookingStatus";
  booking_scheduled_for TIMESTAMP(3);
BEGIN
  SELECT session."status", session."revisionSequence", booking."status", booking."scheduledFor"
    INTO session_status, session_sequence, booking_status, booking_scheduled_for
  FROM public."ConsultSession" AS session
  JOIN public."Booking" AS booking ON booking."id" = session."bookingId"
  WHERE session."id" = NEW."consultSessionId";

  IF NOT public."consult_current_agreements_active"(NEW."consultSessionId") THEN
    RAISE EXCEPTION 'current consent and 18+ attestation are required before sensitive consult revisions'
      USING ERRCODE = '23514';
  END IF;

  IF session_status IN ('CONSENT_REQUIRED', 'CONSENT_REVOKED', 'CANCELLED') THEN
    RAISE EXCEPTION 'consult lifecycle does not permit sensitive revisions in state %', session_status
      USING ERRCODE = '23514';
  END IF;

  IF NEW."kind" = 'INTAKE'
    AND session_status NOT IN ('INTAKE_READY', 'INTAKE_IN_PROGRESS', 'MEDIA_READY')
  THEN
    RAISE EXCEPTION 'consult lifecycle does not permit intake revisions in state %', session_status
      USING ERRCODE = '23514';
  END IF;

  IF booking_status NOT IN ('PENDING', 'ACCEPTED')
    OR booking_scheduled_for <= CURRENT_TIMESTAMP
    OR booking_scheduled_for > CURRENT_TIMESTAMP + INTERVAL '90 days'
  THEN
    RAISE EXCEPTION 'consult booking is not eligible for sensitive revisions'
      USING ERRCODE = '23514';
  END IF;

  IF NEW."revision" <> session_sequence THEN
    RAISE EXCEPTION 'revision number must match the session revision sequence'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
ALTER FUNCTION "consult_revision_requires_agreements"() SET search_path = '';

-- The same exact-version prerequisite applies to direct lifecycle updates.
CREATE OR REPLACE FUNCTION "consult_lifecycle_guard"()
RETURNS TRIGGER AS $$
DECLARE
  allowed BOOLEAN;
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

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
ALTER FUNCTION "consult_lifecycle_guard"() SET search_path = '';

-- C2 adds no public policy. The existing deny-all RLS boundary remains active.
