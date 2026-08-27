-- Full-analysis v2 (decision record 2026-08-26): the consult pack grows from
-- four hair views to seven (adding face_front, face_side, eyes_closeup) and
-- the analysis schema becomes v2 — a cosmetic feature profile plus one style
-- direction per domain beside the existing hair-color content.
--
-- Versioning stance: rows written under pack v1 / schema v1 remain valid
-- (both table constraints become version-branched); everything NEW must be
-- pack v2 / schema v2. Identity, ethnicity, age, and medical language remain
-- forbidden in durable free text; cosmetic undertone/face/eye descriptors are
-- now first-class and left this database-side forbidden list deliberately.

-- 1) UploadSession consult shape: version-branched shot keys.
ALTER TABLE "UploadSession"
  DROP CONSTRAINT "UploadSession_consult_shape";
ALTER TABLE "UploadSession"
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
      AND (
        (
          "shotPackVersion" = 1
          AND "consultShotKey" IN ('hair_back', 'hair_left', 'hair_right', 'hair_crown')
        ) OR (
          "shotPackVersion" = 2
          AND "consultShotKey" IN (
            'hair_back', 'hair_left', 'hair_right', 'hair_crown',
            'face_front', 'face_side', 'eyes_closeup'
          )
        )
      )
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

-- 2) ConsultCapture shape: same version branch. Full re-add (the source text
-- below mirrors 20260907000001 exactly apart from the versioned shot keys).
ALTER TABLE "ConsultCapture"
  DROP CONSTRAINT "ConsultCapture_shape";
ALTER TABLE "ConsultCapture"
  ADD CONSTRAINT "ConsultCapture_shape" CHECK (
    (
      (
        "shotPackVersion" = 1
        AND "shotKey" IN ('hair_back', 'hair_left', 'hair_right', 'hair_crown')
      ) OR (
        "shotPackVersion" = 2
        AND "shotKey" IN (
          'hair_back', 'hair_left', 'hair_right', 'hair_crown',
          'face_front', 'face_side', 'eyes_closeup'
        )
      )
    )
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
  );

-- 2b) Quality provenance: the v2 capture prompt joins the contract. Existing
-- v1 rows stay valid; the analysis prerequisite (section 6) still requires
-- the v2 prompt for every capture the analysis consumes.
ALTER TABLE "ConsultCapture"
  DROP CONSTRAINT "ConsultCapture_quality_contract";
ALTER TABLE "ConsultCapture"
  ADD CONSTRAINT "ConsultCapture_quality_contract" CHECK (
    "status" = 'ATTACHED'
    OR (
      "qualityPromptVersion" IN ('hair-color-capture-v1', 'full-analysis-capture-v2')
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

-- 3) Photo-evidence validator: seven keys.
CREATE OR REPLACE FUNCTION "consult_analysis_evidence_valid"(value JSONB)
RETURNS BOOLEAN AS $$
  SELECT jsonb_typeof(value) = 'array'
    AND jsonb_array_length(value) <= 7
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(value) AS evidence
      WHERE jsonb_typeof(evidence) <> 'string'
        OR evidence #>> '{}' NOT IN (
          'hair_back', 'hair_left', 'hair_right', 'hair_crown',
          'face_front', 'face_side', 'eyes_closeup'
        )
    )
    AND (
      SELECT count(*) = count(DISTINCT evidence #>> '{}')
      FROM jsonb_array_elements(value) AS evidence
    );
$$ LANGUAGE sql IMMUTABLE;
ALTER FUNCTION "consult_analysis_evidence_valid"(JSONB) SET search_path = '';

-- 3b) Style-direction evidence may also cite the intake.
CREATE OR REPLACE FUNCTION "consult_direction_evidence_valid"(value JSONB)
RETURNS BOOLEAN AS $$
  SELECT jsonb_typeof(value) = 'array'
    AND jsonb_array_length(value) BETWEEN 1 AND 8
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(value) AS evidence
      WHERE jsonb_typeof(evidence) <> 'string'
        OR evidence #>> '{}' NOT IN (
          'hair_back', 'hair_left', 'hair_right', 'hair_crown',
          'face_front', 'face_side', 'eyes_closeup', 'intake'
        )
    )
    AND (
      SELECT count(*) = count(DISTINCT evidence #>> '{}')
      FROM jsonb_array_elements(value) AS evidence
    );
$$ LANGUAGE sql IMMUTABLE;
ALTER FUNCTION "consult_direction_evidence_valid"(JSONB) SET search_path = '';

-- 4) Durable-text validator: cosmetic undertone/face/eye descriptors left the
-- forbidden list (2026-08-26 decision); age-adjacent flattery joined it.
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
    AND value #>> '{}' !~* '\m(diagnos(e|is|ed|tic)|dermatolog(y|ist|ical)|disease|disorder|infection|psoriasis|eczema|alopecia|medical|doctor|physician|health condition|identity|ethnic(ity)?|race|nationality|religion|gender|age|aging|youthful|anti[ -]?age)\M';
$$ LANGUAGE sql IMMUTABLE;
ALTER FUNCTION "consult_analysis_text_valid"(JSONB, INTEGER) SET search_path = '';

-- 5) Analysis payload guard v2: full redefinition (supersedes C4 + the W1
-- intent extension). Adds the feature profile and style directions; keeps
-- every hair-color, safety, and recommendation-reference rule.
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
  style_direction JSONB;
BEGIN
  IF NEW."kind" <> 'ANALYSIS' THEN
    RETURN NEW;
  END IF;

  SELECT "status", "serviceCategoryId", "professionalId"
    INTO session_status, session_category_id, session_professional_id
  FROM public."ConsultSession"
  WHERE "id" = NEW."consultSessionId";

  IF session_status <> 'ANALYZING'
    OR NEW."schemaVersion" <> 2
    OR NEW."promptVersion" IS DISTINCT FROM 'full-analysis-v1'
    OR NEW."model" IS NULL
    OR btrim(NEW."model") <> NEW."model"
    OR length(NEW."model") NOT BETWEEN 1 AND 128
    OR jsonb_typeof(NEW."payload") IS DISTINCT FROM 'object'
    OR NOT NEW."payload" ?& ARRAY[
      'profile', 'styleDirections', 'core', 'hairColorLens', 'safetyFlags', 'recommendations'
    ]
    OR NEW."payload" - ARRAY[
      'profile', 'styleDirections', 'core', 'hairColorLens', 'safetyFlags', 'recommendations'
    ] <> '{}'::jsonb
    OR jsonb_typeof(NEW."payload" -> 'profile') IS DISTINCT FROM 'object'
    OR NOT (NEW."payload" -> 'profile') ?& ARRAY[
      'skinUndertone', 'contrastLevel', 'colorSeason', 'faceProportion',
      'jawline', 'foreheadProportion', 'featureBalance', 'eyeShape',
      'eyeSpacing', 'browDensity', 'browShape'
    ]
    OR (NEW."payload" -> 'profile') - ARRAY[
      'skinUndertone', 'contrastLevel', 'colorSeason', 'faceProportion',
      'jawline', 'foreheadProportion', 'featureBalance', 'eyeShape',
      'eyeSpacing', 'browDensity', 'browShape'
    ] <> '{}'::jsonb
    OR NOT public."consult_analysis_observation_valid"(
      NEW."payload" #> '{profile,skinUndertone}',
      ARRAY['WARM', 'COOL', 'NEUTRAL', 'OLIVE', 'UNKNOWN']
    )
    OR NOT public."consult_analysis_observation_valid"(
      NEW."payload" #> '{profile,contrastLevel}',
      ARRAY['LOW', 'MEDIUM', 'HIGH', 'UNKNOWN']
    )
    OR NOT public."consult_analysis_observation_valid"(
      NEW."payload" #> '{profile,colorSeason}',
      ARRAY[
        'BRIGHT_SPRING', 'TRUE_SPRING', 'LIGHT_SPRING', 'LIGHT_SUMMER',
        'TRUE_SUMMER', 'SOFT_SUMMER', 'SOFT_AUTUMN', 'TRUE_AUTUMN',
        'DEEP_AUTUMN', 'DEEP_WINTER', 'TRUE_WINTER', 'BRIGHT_WINTER', 'UNKNOWN'
      ]
    )
    OR NOT public."consult_analysis_observation_valid"(
      NEW."payload" #> '{profile,faceProportion}',
      ARRAY['WIDER', 'BALANCED', 'LONGER', 'UNKNOWN']
    )
    OR NOT public."consult_analysis_observation_valid"(
      NEW."payload" #> '{profile,jawline}',
      ARRAY['SOFTLY_ROUNDED', 'BALANCED', 'ANGULAR', 'UNKNOWN']
    )
    OR NOT public."consult_analysis_observation_valid"(
      NEW."payload" #> '{profile,foreheadProportion}',
      ARRAY['SHORTER', 'BALANCED', 'TALLER', 'UNKNOWN']
    )
    OR NOT public."consult_analysis_observation_valid"(
      NEW."payload" #> '{profile,featureBalance}',
      ARRAY['SOFT', 'BLENDED', 'STRUCTURED', 'UNKNOWN']
    )
    OR NOT public."consult_analysis_observation_valid"(
      NEW."payload" #> '{profile,eyeShape}',
      ARRAY[
        'ALMOND', 'ROUND', 'HOODED', 'MONOLID', 'DOWNTURNED', 'UPTURNED',
        'DEEP_SET', 'PROMINENT', 'UNKNOWN'
      ]
    )
    OR NOT public."consult_analysis_observation_valid"(
      NEW."payload" #> '{profile,eyeSpacing}',
      ARRAY['CLOSE_SET', 'BALANCED', 'WIDE_SET', 'UNKNOWN']
    )
    OR NOT public."consult_analysis_observation_valid"(
      NEW."payload" #> '{profile,browDensity}',
      ARRAY['SPARSE', 'MEDIUM', 'FULL', 'UNKNOWN']
    )
    OR NOT public."consult_analysis_observation_valid"(
      NEW."payload" #> '{profile,browShape}',
      ARRAY['STRAIGHT', 'SOFT_ARCH', 'HIGH_ARCH', 'ROUNDED', 'UNKNOWN']
    )
    OR jsonb_typeof(NEW."payload" -> 'styleDirections') IS DISTINCT FROM 'array'
    OR jsonb_array_length(NEW."payload" -> 'styleDirections') <> 7
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
    RAISE EXCEPTION 'invalid versioned full-analysis payload'
      USING ERRCODE = '23514';
  END IF;

  FOR style_direction IN
    SELECT value FROM jsonb_array_elements(NEW."payload" -> 'styleDirections')
  LOOP
    IF jsonb_typeof(style_direction) IS DISTINCT FROM 'object'
      OR NOT style_direction ?& ARRAY[
        'domain', 'title', 'direction', 'whyItFlatters', 'confidence',
        'evidence', 'discussWithProfessional'
      ]
      OR style_direction - ARRAY[
        'domain', 'title', 'direction', 'whyItFlatters', 'confidence',
        'evidence', 'discussWithProfessional'
      ] <> '{}'::jsonb
      OR style_direction ->> 'domain' NOT IN (
        'HAIR_COLOR_HARMONY', 'CUT_AND_SHAPE', 'BANGS', 'BROWS', 'LASHES',
        'MAKEUP', 'COLOR_PALETTE'
      )
      OR style_direction -> 'discussWithProfessional' IS DISTINCT FROM 'true'::jsonb
      OR NOT public."consult_analysis_text_valid"(style_direction -> 'title', 120)
      OR NOT public."consult_analysis_text_valid"(style_direction -> 'direction', 400)
      OR NOT public."consult_analysis_text_valid"(style_direction -> 'whyItFlatters', 400)
      OR NOT public."consult_analysis_confidence_valid"(style_direction -> 'confidence')
      OR NOT public."consult_direction_evidence_valid"(style_direction -> 'evidence')
    THEN
      RAISE EXCEPTION 'invalid analysis style direction shape'
        USING ERRCODE = '23514';
    END IF;
  END LOOP;

  IF (
    SELECT count(*) <> count(DISTINCT direction_item ->> 'domain')
    FROM jsonb_array_elements(NEW."payload" -> 'styleDirections')
      AS directions(direction_item)
  ) THEN
    RAISE EXCEPTION 'analysis style directions must cover unique domains'
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
        'VIVID_COLOR', 'OTHER_HAIR_COLOR', 'STRAND_TEST', 'PATCH_TEST'
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

-- 6) Analysis prerequisites: the accepted pack is now the seven-shot v2 pack
-- checked under the v2 capture prompt. Preserve the W1 intake pins and the W2
-- inspiration predicate via targeted rewrites of the current definition.
DO $$
DECLARE
  definition TEXT;
  updated TEXT;
BEGIN
  SELECT pg_get_functiondef('public.consult_revision_requires_agreements()'::regprocedure)
    INTO definition;
  updated := replace(
    definition,
    'capture."shotKey" IN (''hair_back'', ''hair_left'', ''hair_right'', ''hair_crown'')',
    'capture."shotKey" IN (''hair_back'', ''hair_left'', ''hair_right'', ''hair_crown'', ''face_front'', ''face_side'', ''eyes_closeup'')'
  );
  updated := replace(updated, 'capture."shotPackVersion" = 1', 'capture."shotPackVersion" = 2');
  updated := replace(updated, 'capture."qualityPromptVersion" = ''hair-color-capture-v1''', 'capture."qualityPromptVersion" = ''full-analysis-capture-v2''');
  updated := replace(updated, 'current_capture_count <> 4', 'current_capture_count <> 7');
  IF position('face_side' in updated) = 0
    OR position('capture."shotPackVersion" = 2' in updated) = 0
    OR position('full-analysis-capture-v2' in updated) = 0
    OR position('current_capture_count <> 7' in updated) = 0
  THEN
    RAISE EXCEPTION 'expected analysis capture prerequisite pins not found';
  END IF;
  EXECUTE updated;
END;
$$;
ALTER FUNCTION "consult_revision_requires_agreements"() SET search_path = '';

-- 6b) Brief guard v3: the deterministic brief carries the feature profile and
-- style directions beside the hair observations. Cosmetic trait keys leave
-- the forbidden-key regex (2026-08-26 decision); raw material and
-- identity/health keys remain forbidden. Preserves the C6+W1+W2 rules via
-- targeted rewrites of the current definition.
DO $$
DECLARE
  definition TEXT;
  updated TEXT;
BEGIN
  SELECT pg_get_functiondef('public.consult_brief_payload_guard()'::regprocedure)
    INTO definition;
  updated := replace(definition, 'IF NEW."schemaVersion" <> 2', 'IF NEW."schemaVersion" <> 3');
  updated := replace(updated, 'hair-color-pro-brief-v2', 'full-analysis-pro-brief-v3');
  updated := replace(updated, 'NEW."payload" -> ''schemaVersion'' <> ''2''::jsonb', 'NEW."payload" -> ''schemaVersion'' <> ''3''::jsonb');
  updated := replace(
    updated,
    '''aiObservations'', ''safetyFlags''',
    '''aiObservations'', ''profile'', ''styleDirections'', ''safetyFlags'''
  );
  updated := replace(
    updated,
    'OR NEW."payload" #> ''{achievabilityDirection,discussWithProfessional}'' IS DISTINCT FROM ''true''::jsonb',
    'OR NEW."payload" #> ''{achievabilityDirection,discussWithProfessional}'' IS DISTINCT FROM ''true''::jsonb OR jsonb_typeof(NEW."payload" -> ''profile'') IS DISTINCT FROM ''object'' OR jsonb_typeof(NEW."payload" -> ''styleDirections'') IS DISTINCT FROM ''array'' OR jsonb_array_length(NEW."payload" -> ''styleDirections'') <> 7 OR EXISTS (SELECT 1 FROM jsonb_array_elements(NEW."payload" -> ''styleDirections'') AS direction WHERE direction -> ''discussWithProfessional'' IS DISTINCT FROM ''true''::jsonb)'
  );
  updated := replace(
    updated,
    'hiddenReasoning|skinTone|undertone|faceShape|eyeShape|identity',
    'hiddenReasoning|identity'
  );
  IF position('full-analysis-pro-brief-v3' in updated) = 0
    OR position('''styleDirections'', ''safetyFlags''' in updated) = 0
    OR position('jsonb_array_length(NEW."payload" -> ''styleDirections'') <> 7' in updated) = 0
    OR position('skinTone' in updated) > 0
  THEN
    RAISE EXCEPTION 'expected C6 brief guard pins not found';
  END IF;
  EXECUTE updated;
END;
$$;
ALTER FUNCTION "consult_brief_payload_guard"() SET search_path = '';

-- 7) Lifecycle guard: the accepted/purge-marked slot counts become seven.
DO $$
DECLARE
  definition TEXT;
  updated TEXT;
BEGIN
  SELECT pg_get_functiondef('public.consult_lifecycle_guard()'::regprocedure)
    INTO definition;
  updated := replace(definition, 'accepted_slot_count <> 4', 'accepted_slot_count <> 7');
  updated := replace(updated, 'purge_mark_count <> 4', 'purge_mark_count <> 7');
  updated := replace(updated, 'four purge-marked captures', 'seven purge-marked captures');
  IF position('accepted_slot_count <> 7' in updated) = 0
    OR position('purge_mark_count <> 7' in updated) = 0
  THEN
    RAISE EXCEPTION 'expected lifecycle slot-count pins not found';
  END IF;
  EXECUTE updated;
END;
$$;
ALTER FUNCTION "consult_lifecycle_guard"() SET search_path = '';
