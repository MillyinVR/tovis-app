-- AI Consult Phase 0 C4: one immutable, version-pinned hair-color analysis.
-- Raw captures remain private/ephemeral; this migration stores only bounded
-- structured output and authoritative catalog references.

ALTER TABLE "ConsultRevision"
  DROP CONSTRAINT "ConsultRevision_idempotency_shape",
  ADD CONSTRAINT "ConsultRevision_idempotency_shape" CHECK (
    (
      "kind" = 'BRIEF'
      AND "idempotencyKey" IS NULL
      AND "requestHash" IS NULL
    )
    OR
    (
      "kind" IN ('INTAKE', 'ANALYSIS')
      AND "idempotencyKey" IS NOT NULL
      AND "requestHash" IS NOT NULL
      AND btrim("idempotencyKey") = "idempotencyKey"
      AND length(btrim("idempotencyKey")) BETWEEN 1 AND 128
      AND "requestHash" ~ '^[0-9a-f]{64}$'
    )
  );

CREATE UNIQUE INDEX "ConsultRevision_one_analysis_per_session"
  ON "ConsultRevision" ("consultSessionId")
  WHERE "kind" = 'ANALYSIS';

CREATE UNIQUE INDEX "ConsultAuditEvent_one_analysis_claim_transition"
  ON "ConsultAuditEvent" ("consultSessionId", "fromStatus", "toStatus")
  WHERE "action" = 'LIFECYCLE_TRANSITIONED'
    AND "fromStatus" = 'ANALYSIS_PENDING'
    AND "toStatus" = 'ANALYZING';

CREATE UNIQUE INDEX "ConsultAuditEvent_one_analysis_complete_transition"
  ON "ConsultAuditEvent" ("consultSessionId", "fromStatus", "toStatus")
  WHERE "action" = 'LIFECYCLE_TRANSITIONED'
    AND "fromStatus" = 'ANALYZING'
    AND "toStatus" = 'COMPLETED';

CREATE OR REPLACE FUNCTION "consult_analysis_confidence_valid"(value JSONB)
RETURNS BOOLEAN AS $$
  SELECT jsonb_typeof(value) = 'object'
    AND value ?& ARRAY['min', 'max']
    AND value - ARRAY['min', 'max'] = '{}'::jsonb
    AND jsonb_typeof(value -> 'min') = 'number'
    AND jsonb_typeof(value -> 'max') = 'number'
    AND (value ->> 'min')::numeric >= 0
    AND (value ->> 'max')::numeric <= 1
    AND (value ->> 'min')::numeric < (value ->> 'max')::numeric;
$$ LANGUAGE sql IMMUTABLE;
ALTER FUNCTION "consult_analysis_confidence_valid"(JSONB) SET search_path = '';

CREATE OR REPLACE FUNCTION "consult_analysis_evidence_valid"(value JSONB)
RETURNS BOOLEAN AS $$
  SELECT jsonb_typeof(value) = 'array'
    AND jsonb_array_length(value) <= 4
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(value) AS evidence
      WHERE jsonb_typeof(evidence) <> 'string'
        OR evidence #>> '{}' NOT IN (
          'hair_back', 'hair_left', 'hair_right', 'hair_crown'
        )
    )
    AND (
      SELECT count(*) = count(DISTINCT evidence #>> '{}')
      FROM jsonb_array_elements(value) AS evidence
    );
$$ LANGUAGE sql IMMUTABLE;
ALTER FUNCTION "consult_analysis_evidence_valid"(JSONB) SET search_path = '';

CREATE OR REPLACE FUNCTION "consult_analysis_text_valid"(
  value JSONB,
  maximum_length INTEGER
)
RETURNS BOOLEAN AS $$
  SELECT jsonb_typeof(value) = 'string'
    AND value #>> '{}' = btrim(value #>> '{}')
    AND length(value #>> '{}') BETWEEN 1 AND maximum_length
    AND value #>> '{}' !~ '[[:space:]]{2,}'
    AND value #>> '{}' !~ '[\n\r\t]'
    AND value #>> '{}' !~* '\m(diagnos(e|is|ed|tic)|dermatolog(y|ist|ical)|disease|disorder|infection|psoriasis|eczema|alopecia|medical|doctor|physician|health condition|identity|ethnic(ity)?|race|nationality|religion|gender|age|skin[ -]?tone|under[ -]?tone|face shape|eye shape)\M';
$$ LANGUAGE sql IMMUTABLE;
ALTER FUNCTION "consult_analysis_text_valid"(JSONB, INTEGER) SET search_path = '';

CREATE OR REPLACE FUNCTION "consult_analysis_observation_valid"(
  value JSONB,
  allowed_values TEXT[]
)
RETURNS BOOLEAN AS $$
  SELECT jsonb_typeof(value) = 'object'
    AND value ?& ARRAY['value', 'confidence', 'evidence']
    AND value - ARRAY['value', 'confidence', 'evidence'] = '{}'::jsonb
    AND value ->> 'value' = ANY(allowed_values)
    AND public."consult_analysis_confidence_valid"(value -> 'confidence')
    AND public."consult_analysis_evidence_valid"(value -> 'evidence')
    AND (
      (
        value ->> 'value' = 'UNKNOWN'
        AND jsonb_array_length(value -> 'evidence') = 0
        AND (value #>> '{confidence,max}')::numeric <= 0.35
      )
      OR
      (
        value ->> 'value' <> 'UNKNOWN'
        AND jsonb_array_length(value -> 'evidence') > 0
      )
    );
$$ LANGUAGE sql IMMUTABLE;
ALTER FUNCTION "consult_analysis_observation_valid"(JSONB, TEXT[]) SET search_path = '';

CREATE OR REPLACE FUNCTION "consult_analysis_payload_guard"()
RETURNS TRIGGER AS $$
DECLARE
  session_status public."ConsultSessionStatus";
  session_category_id TEXT;
  session_professional_id TEXT;
  recommendation JSONB;
  reference JSONB;
  safety_flag JSONB;
  intake_payload JSONB;
BEGIN
  IF NEW."kind" <> 'ANALYSIS' THEN
    RETURN NEW;
  END IF;

  SELECT "status", "serviceCategoryId", "professionalId"
    INTO session_status, session_category_id, session_professional_id
  FROM public."ConsultSession"
  WHERE "id" = NEW."consultSessionId";

  IF session_status <> 'ANALYZING'
    OR NEW."schemaVersion" <> 1
    OR NEW."promptVersion" IS DISTINCT FROM 'hair-color-analysis-v1'
    OR NEW."model" IS NULL
    OR btrim(NEW."model") <> NEW."model"
    OR length(NEW."model") NOT BETWEEN 1 AND 128
    OR jsonb_typeof(NEW."payload") IS DISTINCT FROM 'object'
    OR NOT NEW."payload" ?& ARRAY[
      'core', 'hairColorLens', 'safetyFlags', 'recommendations'
    ]
    OR NEW."payload" - ARRAY[
      'core', 'hairColorLens', 'safetyFlags', 'recommendations'
    ] <> '{}'::jsonb
    OR jsonb_typeof(NEW."payload" -> 'core') IS DISTINCT FROM 'object'
    OR NOT (NEW."payload" -> 'core') ?& ARRAY[
      'currentLevel', 'currentTone', 'visibleCondition', 'density', 'texture'
    ]
    OR (NEW."payload" -> 'core') - ARRAY[
      'currentLevel', 'currentTone', 'visibleCondition', 'density', 'texture'
    ] <> '{}'::jsonb
    OR jsonb_typeof(NEW."payload" #> '{core,currentLevel}') IS DISTINCT FROM 'object'
    OR NOT (NEW."payload" #> '{core,currentLevel}') ?& ARRAY[
      'min', 'max', 'confidence', 'evidence'
    ]
    OR (NEW."payload" #> '{core,currentLevel}') - ARRAY[
      'min', 'max', 'confidence', 'evidence'
    ] <> '{}'::jsonb
    OR NOT public."consult_analysis_confidence_valid"(
      NEW."payload" #> '{core,currentLevel,confidence}'
    )
    OR NOT public."consult_analysis_evidence_valid"(
      NEW."payload" #> '{core,currentLevel,evidence}'
    )
    OR NOT (
      (
        NEW."payload" #> '{core,currentLevel,min}' = 'null'::jsonb
        AND NEW."payload" #> '{core,currentLevel,max}' = 'null'::jsonb
        AND jsonb_array_length(NEW."payload" #> '{core,currentLevel,evidence}') = 0
        AND (NEW."payload" #>> '{core,currentLevel,confidence,max}')::numeric <= 0.35
      )
      OR
      (
        jsonb_typeof(NEW."payload" #> '{core,currentLevel,min}') = 'number'
        AND jsonb_typeof(NEW."payload" #> '{core,currentLevel,max}') = 'number'
        AND (NEW."payload" #>> '{core,currentLevel,min}')::numeric BETWEEN 1 AND 10
        AND (NEW."payload" #>> '{core,currentLevel,max}')::numeric BETWEEN 1 AND 10
        AND mod((NEW."payload" #>> '{core,currentLevel,min}')::numeric, 1) = 0
        AND mod((NEW."payload" #>> '{core,currentLevel,max}')::numeric, 1) = 0
        AND (NEW."payload" #>> '{core,currentLevel,min}')::numeric
          <= (NEW."payload" #>> '{core,currentLevel,max}')::numeric
        AND jsonb_array_length(NEW."payload" #> '{core,currentLevel,evidence}') > 0
      )
    )
    OR NOT public."consult_analysis_observation_valid"(
      NEW."payload" #> '{core,currentTone}',
      ARRAY['ASHY', 'NEUTRAL', 'GOLDEN', 'COPPER', 'RED', 'MIXED', 'UNKNOWN']
    )
    OR NOT public."consult_analysis_observation_valid"(
      NEW."payload" #> '{core,visibleCondition}',
      ARRAY['NO_VISIBLE_CONCERN', 'POSSIBLE_COMPROMISE', 'UNKNOWN']
    )
    OR NOT public."consult_analysis_observation_valid"(
      NEW."payload" #> '{core,density}',
      ARRAY['LOW', 'MEDIUM', 'HIGH', 'UNKNOWN']
    )
    OR NOT public."consult_analysis_observation_valid"(
      NEW."payload" #> '{core,texture}',
      ARRAY['STRAIGHT', 'WAVY', 'CURLY', 'COILY', 'MIXED', 'UNKNOWN']
    )
    OR jsonb_typeof(NEW."payload" -> 'hairColorLens') IS DISTINCT FROM 'object'
    OR NOT (NEW."payload" -> 'hairColorLens') ?& ARRAY[
      'goal', 'history', 'constraints', 'maintenance', 'appointmentContext',
      'achievability', 'achievabilityReason', 'discussWithProfessional'
    ]
    OR (NEW."payload" -> 'hairColorLens') - ARRAY[
      'goal', 'history', 'constraints', 'maintenance', 'appointmentContext',
      'achievability', 'achievabilityReason', 'discussWithProfessional'
    ] <> '{}'::jsonb
    OR NEW."payload" #> '{hairColorLens,discussWithProfessional}' IS DISTINCT FROM 'true'::jsonb
    OR NEW."payload" #>> '{hairColorLens,achievability}' NOT IN (
      'LIKELY_SINGLE_APPOINTMENT', 'LIKELY_MULTI_APPOINTMENT',
      'REQUIRES_PRO_ASSESSMENT', 'UNKNOWN'
    )
    OR NOT public."consult_analysis_text_valid"(NEW."payload" #> '{hairColorLens,goal}', 240)
    OR NOT public."consult_analysis_text_valid"(NEW."payload" #> '{hairColorLens,history}', 320)
    OR NOT public."consult_analysis_text_valid"(NEW."payload" #> '{hairColorLens,constraints}', 240)
    OR NOT public."consult_analysis_text_valid"(NEW."payload" #> '{hairColorLens,maintenance}', 240)
    OR NOT public."consult_analysis_text_valid"(NEW."payload" #> '{hairColorLens,appointmentContext}', 240)
    OR NOT public."consult_analysis_text_valid"(NEW."payload" #> '{hairColorLens,achievabilityReason}', 320)
    OR NEW."payload" #>> '{hairColorLens,constraints}' !~* '(unknown|not collected|not provided)'
    OR NEW."payload" #>> '{hairColorLens,maintenance}' !~* '(unknown|not collected|not provided)'
    OR jsonb_typeof(NEW."payload" -> 'safetyFlags') IS DISTINCT FROM 'array'
    OR jsonb_array_length(NEW."payload" -> 'safetyFlags') > 7
    OR jsonb_typeof(NEW."payload" -> 'recommendations') IS DISTINCT FROM 'array'
    OR jsonb_array_length(NEW."payload" -> 'recommendations') NOT BETWEEN 1 AND 3
    OR NEW."payload"::text ~ '"(base64|signedUrl|token|storagePath|storageBucket|providerRequest|providerResponse|hiddenReasoning)"[[:space:]]*:'
  THEN
    RAISE EXCEPTION 'invalid versioned hair-color analysis payload'
      USING ERRCODE = '23514';
  END IF;

  FOR safety_flag IN
    SELECT value FROM jsonb_array_elements(NEW."payload" -> 'safetyFlags')
  LOOP
    IF jsonb_typeof(safety_flag) IS DISTINCT FROM 'object'
      OR NOT safety_flag ?& ARRAY['code', 'summary', 'discussWithProfessional']
      OR safety_flag - ARRAY['code', 'summary', 'discussWithProfessional'] <> '{}'::jsonb
      OR safety_flag ->> 'code' NOT IN (
        'PRIOR_REACTION', 'REACTION_HISTORY_UNKNOWN', 'RECENT_BOX_DYE',
        'RECENT_LIGHTENING', 'CHEMICAL_HISTORY_UNKNOWN',
        'ALLERGY_HISTORY_UNKNOWN', 'VISIBLE_COMPROMISE'
      )
      OR NOT public."consult_analysis_text_valid"(safety_flag -> 'summary', 240)
      OR safety_flag -> 'discussWithProfessional' IS DISTINCT FROM 'true'::jsonb
    THEN
      RAISE EXCEPTION 'invalid analysis safety flag shape'
        USING ERRCODE = '23514';
    END IF;
  END LOOP;

  IF (
    SELECT count(*) <> count(DISTINCT flag_item ->> 'code')
    FROM jsonb_array_elements(NEW."payload" -> 'safetyFlags') AS flags(flag_item)
  ) THEN
    RAISE EXCEPTION 'analysis safety flags must be unique'
      USING ERRCODE = '23514';
  END IF;

  SELECT "payload" INTO intake_payload
  FROM public."ConsultRevision"
  WHERE "consultSessionId" = NEW."consultSessionId"
    AND "kind" = 'INTAKE'
  ORDER BY "revision" DESC
  LIMIT 1;

  IF NOT (NEW."payload" -> 'safetyFlags') @> '[{"code":"ALLERGY_HISTORY_UNKNOWN"}]'::jsonb
    OR (
      intake_payload #>> '{answers,prior_reaction}' = 'yes'
      AND NOT (NEW."payload" -> 'safetyFlags') @> '[{"code":"PRIOR_REACTION"}]'::jsonb
    )
    OR (
      intake_payload #>> '{answers,prior_reaction}' = 'not-sure'
      AND NOT (NEW."payload" -> 'safetyFlags') @> '[{"code":"REACTION_HISTORY_UNKNOWN"}]'::jsonb
    )
    OR (
      intake_payload #>> '{answers,box_dye_history}' = 'within-6-months'
      AND NOT (NEW."payload" -> 'safetyFlags') @> '[{"code":"RECENT_BOX_DYE"}]'::jsonb
    )
    OR (
      (
        intake_payload #>> '{answers,box_dye_history}' = 'not-sure'
        OR intake_payload #>> '{answers,prior_lightening}' = 'not-sure'
      )
      AND NOT (NEW."payload" -> 'safetyFlags') @> '[{"code":"CHEMICAL_HISTORY_UNKNOWN"}]'::jsonb
    )
    OR (
      intake_payload #>> '{answers,prior_lightening}' IN ('within-3-months', '3-6-months')
      AND NOT (NEW."payload" -> 'safetyFlags') @> '[{"code":"RECENT_LIGHTENING"}]'::jsonb
    )
    OR (
      NEW."payload" #>> '{core,visibleCondition,value}' = 'POSSIBLE_COMPROMISE'
      AND NOT (NEW."payload" -> 'safetyFlags') @> '[{"code":"VISIBLE_COMPROMISE"}]'::jsonb
    )
    OR (
      (NEW."payload" -> 'safetyFlags') @> '[{"code":"PRIOR_REACTION"}]'::jsonb
      AND intake_payload #>> '{answers,prior_reaction}' IS DISTINCT FROM 'yes'
    )
    OR (
      (NEW."payload" -> 'safetyFlags') @> '[{"code":"REACTION_HISTORY_UNKNOWN"}]'::jsonb
      AND intake_payload #>> '{answers,prior_reaction}' IS DISTINCT FROM 'not-sure'
    )
    OR (
      (NEW."payload" -> 'safetyFlags') @> '[{"code":"RECENT_BOX_DYE"}]'::jsonb
      AND intake_payload #>> '{answers,box_dye_history}' IS DISTINCT FROM 'within-6-months'
    )
    OR (
      (NEW."payload" -> 'safetyFlags') @> '[{"code":"CHEMICAL_HISTORY_UNKNOWN"}]'::jsonb
      AND intake_payload #>> '{answers,box_dye_history}' IS DISTINCT FROM 'not-sure'
      AND intake_payload #>> '{answers,prior_lightening}' IS DISTINCT FROM 'not-sure'
    )
    OR (
      (NEW."payload" -> 'safetyFlags') @> '[{"code":"RECENT_LIGHTENING"}]'::jsonb
      AND intake_payload #>> '{answers,prior_lightening}' NOT IN (
        'within-3-months', '3-6-months'
      )
    )
    OR (
      (NEW."payload" -> 'safetyFlags') @> '[{"code":"VISIBLE_COMPROMISE"}]'::jsonb
      AND NEW."payload" #>> '{core,visibleCondition,value}' IS DISTINCT FROM 'POSSIBLE_COMPROMISE'
    )
  THEN
    RAISE EXCEPTION 'analysis is missing required structured safety flags'
      USING ERRCODE = '23514';
  END IF;

  FOR recommendation IN
    SELECT value FROM jsonb_array_elements(NEW."payload" -> 'recommendations')
  LOOP
    IF jsonb_typeof(recommendation) IS DISTINCT FROM 'object'
      OR NOT recommendation ?& ARRAY[
        'serviceIntent', 'title', 'rationale', 'achievability',
        'discussWithProfessional', 'reference'
      ]
      OR recommendation - ARRAY[
        'serviceIntent', 'title', 'rationale', 'achievability',
        'discussWithProfessional', 'reference'
      ] <> '{}'::jsonb
      OR recommendation -> 'discussWithProfessional' IS DISTINCT FROM 'true'::jsonb
      OR NOT public."consult_analysis_text_valid"(recommendation -> 'title', 120)
      OR NOT public."consult_analysis_text_valid"(recommendation -> 'rationale', 320)
      OR NOT public."consult_analysis_text_valid"(recommendation -> 'achievability', 240)
      OR recommendation ->> 'serviceIntent' NOT IN (
        'COLOR_CONSULTATION', 'ROOT_TOUCH_UP', 'ALL_OVER_COLOR',
        'HIGHLIGHTS', 'BALAYAGE', 'COLOR_CORRECTION', 'TONER_GLOSS',
        'VIVID_COLOR', 'OTHER_HAIR_COLOR'
      )
      OR jsonb_typeof(recommendation -> 'reference') IS DISTINCT FROM 'object'
    THEN
      RAISE EXCEPTION 'invalid analysis recommendation shape'
        USING ERRCODE = '23514';
    END IF;

    reference := recommendation -> 'reference';
    IF NOT reference ?& ARRAY['type', 'serviceId', 'serviceCategoryId'] THEN
      RAISE EXCEPTION 'analysis recommendation reference is incomplete'
        USING ERRCODE = '23514';
    END IF;
    IF reference ->> 'serviceCategoryId' IS DISTINCT FROM session_category_id THEN
      RAISE EXCEPTION 'analysis recommendation category is outside booking scope'
        USING ERRCODE = '23514';
    END IF;

    IF reference ->> 'type' = 'SERVICE' THEN
      IF reference - ARRAY['type', 'serviceId', 'serviceCategoryId'] <> '{}'::jsonb
        OR NOT EXISTS (
          SELECT 1
          FROM public."Service" AS service
          JOIN public."ServiceCategory" AS category
            ON category."id" = service."categoryId"
          JOIN public."ProfessionalServiceOffering" AS offering
            ON offering."serviceId" = service."id"
           AND offering."professionalId" = session_professional_id
          WHERE service."id" = reference ->> 'serviceId'
            AND service."categoryId" = session_category_id
            AND service."isActive"
            AND category."isActive"
            AND category."slug" = 'hair-color'
            AND offering."isActive"
        )
      THEN
        RAISE EXCEPTION 'analysis service reference is unavailable'
          USING ERRCODE = '23514';
      END IF;
    ELSIF reference ->> 'type' = 'SERVICE_CATEGORY' THEN
      IF reference - ARRAY['type', 'serviceId', 'serviceCategoryId'] <> '{}'::jsonb
        OR reference -> 'serviceId' IS DISTINCT FROM 'null'::jsonb
        OR NOT EXISTS (
          SELECT 1 FROM public."ServiceCategory"
          WHERE "id" = session_category_id
            AND "slug" = 'hair-color'
            AND "isActive"
        )
      THEN
        RAISE EXCEPTION 'analysis category reference is unavailable'
          USING ERRCODE = '23514';
      END IF;
    ELSE
      RAISE EXCEPTION 'analysis recommendation reference type is invalid'
        USING ERRCODE = '23514';
    END IF;
  END LOOP;

  IF (
    SELECT count(*) <> count(DISTINCT recommendation_item ->> 'serviceIntent')
    FROM jsonb_array_elements(NEW."payload" -> 'recommendations')
      AS recommendations(recommendation_item)
  ) THEN
    RAISE EXCEPTION 'analysis recommendation intents must be unique'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
ALTER FUNCTION "consult_analysis_payload_guard"() SET search_path = '';

CREATE TRIGGER "ConsultRevision_analysis_payload_guard"
  BEFORE INSERT ON "ConsultRevision"
  FOR EACH ROW EXECUTE FUNCTION "consult_analysis_payload_guard"();

-- Strengthen the existing revision prerequisite backstop for C4. The latest
-- intake must be complete/current, and the exact accepted pack must still be
-- present, unexpired, unpurged, and version-pinned at ANALYSIS insert time.
CREATE OR REPLACE FUNCTION "consult_revision_requires_agreements"()
RETURNS TRIGGER AS $$
DECLARE
  session_status public."ConsultSessionStatus";
  session_sequence INTEGER;
  booking_status public."BookingStatus";
  booking_scheduled_for TIMESTAMP(3);
  current_intake_count INTEGER;
  current_capture_count INTEGER;
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
  IF NEW."kind" = 'ANALYSIS' AND session_status <> 'ANALYZING' THEN
    RAISE EXCEPTION 'consult lifecycle does not permit analysis revision in state %', session_status
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

  IF NEW."kind" = 'ANALYSIS' THEN
    SELECT count(*)::integer INTO current_intake_count
    FROM public."ConsultRevision" AS intake
    WHERE intake."id" = (
      SELECT latest."id"
      FROM public."ConsultRevision" AS latest
      WHERE latest."consultSessionId" = NEW."consultSessionId"
        AND latest."kind" = 'INTAKE'
      ORDER BY latest."revision" DESC
      LIMIT 1
    )
      AND intake."schemaVersion" = 1
      AND intake."payload" ->> 'packId' = 'hair-color'
      AND intake."payload" -> 'packVersion' = '1'::jsonb
      AND intake."payload" -> 'schemaVersion' = '1'::jsonb
      AND intake."payload" -> 'complete' = 'true'::jsonb;

    SELECT count(DISTINCT capture."shotKey")::integer INTO current_capture_count
    FROM public."ConsultCapture" AS capture
    JOIN public."UploadSession" AS upload ON upload."id" = capture."uploadSessionId"
    WHERE capture."consultSessionId" = NEW."consultSessionId"
      AND capture."shotKey" IN ('hair_back', 'hair_left', 'hair_right', 'hair_crown')
      AND capture."shotPackVersion" = 1
      AND capture."schemaVersion" = 1
      AND capture."status" = 'ACCEPTED'
      AND capture."qualityReasonCode" = 'PASS'
      AND capture."qualitySchemaVersion" = 1
      AND capture."qualityPromptVersion" = 'hair-color-capture-v1'
      AND capture."storageBucket" = 'media-private'
      AND capture."storagePath" IS NOT NULL
      AND capture."rawExpiresAt" > CURRENT_TIMESTAMP
      AND capture."purgeEligibleAt" IS NULL
      AND capture."purgeRequestedAt" IS NULL
      AND capture."purgedAt" IS NULL
      AND upload."surface" = 'CLIENT_CONSULT'
      AND upload."status" = 'CONSUMED'
      AND upload."consultSessionId" = NEW."consultSessionId"
      AND upload."consultShotKey" = capture."shotKey"
      AND upload."storagePath" = capture."storagePath"
      AND upload."purgedAt" IS NULL;

    IF current_intake_count <> 1 OR current_capture_count <> 4 THEN
      RAISE EXCEPTION 'analysis requires current completed intake and exact accepted capture pack'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
ALTER FUNCTION "consult_revision_requires_agreements"() SET search_path = '';

CREATE OR REPLACE FUNCTION "consult_analysis_revision_requires_audit"()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."kind" = 'ANALYSIS' AND NOT EXISTS (
    SELECT 1 FROM public."ConsultAuditEvent"
    WHERE "revisionId" = NEW."id"
      AND "consultSessionId" = NEW."consultSessionId"
      AND "action" = 'REVISION_CREATED'
  ) THEN
    RAISE EXCEPTION 'analysis revision requires atomic content-free audit evidence'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
ALTER FUNCTION "consult_analysis_revision_requires_audit"() SET search_path = '';

CREATE CONSTRAINT TRIGGER "ConsultRevision_analysis_requires_audit"
  AFTER INSERT ON "ConsultRevision"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "consult_analysis_revision_requires_audit"();

CREATE OR REPLACE FUNCTION "consult_analysis_transition_requires_audit"()
RETURNS TRIGGER AS $$
BEGIN
  IF (OLD."status", NEW."status") IN (
    ('ANALYSIS_PENDING'::public."ConsultSessionStatus", 'ANALYZING'::public."ConsultSessionStatus"),
    ('ANALYZING'::public."ConsultSessionStatus", 'COMPLETED'::public."ConsultSessionStatus")
  ) AND NOT EXISTS (
    SELECT 1 FROM public."ConsultAuditEvent"
    WHERE "consultSessionId" = NEW."id"
      AND "action" = 'LIFECYCLE_TRANSITIONED'
      AND "fromStatus" = OLD."status"
      AND "toStatus" = NEW."status"
  ) THEN
    RAISE EXCEPTION 'analysis lifecycle transition requires atomic audit evidence'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
ALTER FUNCTION "consult_analysis_transition_requires_audit"() SET search_path = '';

CREATE CONSTRAINT TRIGGER "ConsultSession_analysis_transition_requires_audit"
  AFTER UPDATE OF "status" ON "ConsultSession"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "consult_analysis_transition_requires_audit"();

CREATE OR REPLACE FUNCTION "consult_lifecycle_guard"()
RETURNS TRIGGER AS $$
DECLARE
  allowed BOOLEAN;
  accepted_slot_count INTEGER;
  completed_analysis_count INTEGER;
  purge_mark_count INTEGER;
BEGIN
  IF NEW."status" = OLD."status" THEN RETURN NEW; END IF;
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
    SELECT count(DISTINCT "shotKey") INTO accepted_slot_count
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
  IF OLD."status" = 'ANALYZING' AND NEW."status" = 'COMPLETED' THEN
    SELECT count(*)::integer INTO completed_analysis_count
    FROM public."ConsultRevision"
    WHERE "consultSessionId" = NEW."id"
      AND "kind" = 'ANALYSIS'
      AND "revision" = NEW."revisionSequence";
    SELECT count(DISTINCT "shotKey")::integer INTO purge_mark_count
    FROM public."ConsultCapture"
    WHERE "consultSessionId" = NEW."id"
      AND "status" = 'ACCEPTED'
      AND "purgeEligibleAt" IS NOT NULL
      AND "purgeRequestedAt" IS NOT NULL
      AND "purgedAt" IS NULL;
    IF completed_analysis_count <> 1 OR purge_mark_count <> 4 THEN
      RAISE EXCEPTION 'completed analysis requires one current revision and four purge-marked captures'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
ALTER FUNCTION "consult_lifecycle_guard"() SET search_path = '';

-- Existing deny-all RLS remains enabled on every consult table. No policy is
-- added here; the server boundary is the only analysis reader/writer.
