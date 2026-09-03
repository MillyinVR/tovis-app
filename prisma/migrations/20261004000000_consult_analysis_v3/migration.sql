-- Service-aware consult, slice 2: analysis schema v3 / prompt service-analysis-v3
-- (Tori, 2026-09-03 — docs/product/CONSULT-SERVICE-AWARE-PLAN.md).
--
-- The ANALYSIS payload guard is re-issued in full (current definition =
-- 20260914000000 as patched by 20260921000000). What changes:
--
--   * schemaVersion 3, promptVersion 'service-analysis-v3';
--   * `hairColorLens` → `serviceLens` (same eight fields, same text rules);
--   * safety codes gain RECENT_CHEMICAL_SERVICE, KNOWN_ALLERGY and
--     SENSITIVITY_REPORTED; the "required flags" cross-check against the intake
--     now branches on the intake PACK (lib/consult/safetyFlags.ts mirrored):
--     colour keeps its rules byte-for-byte, hair-general and general-service
--     get theirs, and the lens-must-say-unknown rule applies only where the
--     pack did not ask;
--   * a recommendation carries `serviceIntent` ∈ (SERVICE, CONSULTATION,
--     STRAND_TEST, PATCH_TEST) and `serviceName` (a string for SERVICE, null
--     otherwise); the colour intent enum is gone; uniqueness is by intent+name;
--   * a SERVICE reference must be an active offering of THIS pro in THIS
--     category (no slug pin); a PATCH_TEST / STRAND_TEST reference may sit in
--     ANY of the pro's categories (the tests are one service however filed),
--     so the "reference category is the session's" rule is relaxed for those
--     two intents only.
--
-- Additive for deployed code: no v2 row exists in production (0 ANALYSIS
-- revisions on 2026-09-03), and a v2 writer would now be refused, which is the
-- point — the code that writes v3 ships with this migration.

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
  intake_answers JSONB;
  intake_pack TEXT;
  style_direction JSONB;
  flags JSONB;
  required_codes TEXT[];
  code TEXT;
  lens_constraints_must_be_unknown BOOLEAN;
  lens_maintenance_must_be_unknown BOOLEAN;
BEGIN
  IF NEW."kind" <> 'ANALYSIS' THEN
    RETURN NEW;
  END IF;

  SELECT "status", "serviceCategoryId", "professionalId"
    INTO session_status, session_category_id, session_professional_id
  FROM public."ConsultSession"
  WHERE "id" = NEW."consultSessionId";

  IF session_status <> 'ANALYZING'
    OR NEW."schemaVersion" <> 3
    OR NEW."promptVersion" IS DISTINCT FROM 'service-analysis-v3'
    OR NEW."model" IS NULL
    OR btrim(NEW."model") <> NEW."model"
    OR length(NEW."model") NOT BETWEEN 1 AND 128
    OR jsonb_typeof(NEW."payload") IS DISTINCT FROM 'object'
    OR NOT NEW."payload" ?& ARRAY[
      'profile', 'styleDirections', 'core', 'serviceLens', 'safetyFlags', 'recommendations'
    ]
    OR NEW."payload" - ARRAY[
      'profile', 'styleDirections', 'core', 'serviceLens', 'safetyFlags', 'recommendations'
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
    OR jsonb_typeof(NEW."payload" -> 'serviceLens') IS DISTINCT FROM 'object'
    OR NOT (NEW."payload" -> 'serviceLens') ?& ARRAY[
      'goal', 'history', 'constraints', 'maintenance', 'appointmentContext',
      'achievability', 'achievabilityReason', 'discussWithProfessional'
    ]
    OR (NEW."payload" -> 'serviceLens') - ARRAY[
      'goal', 'history', 'constraints', 'maintenance', 'appointmentContext',
      'achievability', 'achievabilityReason', 'discussWithProfessional'
    ] <> '{}'::jsonb
    OR NEW."payload" #> '{serviceLens,discussWithProfessional}' IS DISTINCT FROM 'true'::jsonb
    OR NEW."payload" #>> '{serviceLens,achievability}' NOT IN (
      'LIKELY_SINGLE_APPOINTMENT', 'LIKELY_MULTI_APPOINTMENT',
      'REQUIRES_PRO_ASSESSMENT', 'UNKNOWN'
    )
    OR NOT public."consult_analysis_text_valid"(NEW."payload" #> '{serviceLens,goal}', 240)
    OR NOT public."consult_analysis_text_valid"(NEW."payload" #> '{serviceLens,history}', 320)
    OR NOT public."consult_analysis_text_valid"(NEW."payload" #> '{serviceLens,constraints}', 240)
    OR NOT public."consult_analysis_text_valid"(NEW."payload" #> '{serviceLens,maintenance}', 240)
    OR NOT public."consult_analysis_text_valid"(NEW."payload" #> '{serviceLens,appointmentContext}', 240)
    OR NOT public."consult_analysis_text_valid"(NEW."payload" #> '{serviceLens,achievabilityReason}', 320)
    OR jsonb_typeof(NEW."payload" -> 'safetyFlags') IS DISTINCT FROM 'array'
    OR jsonb_array_length(NEW."payload" -> 'safetyFlags') > 10
    OR jsonb_typeof(NEW."payload" -> 'recommendations') IS DISTINCT FROM 'array'
    OR jsonb_array_length(NEW."payload" -> 'recommendations') NOT BETWEEN 1 AND 3
    OR NEW."payload"::text ~ '"(base64|signedUrl|token|storagePath|storageBucket|providerRequest|providerResponse|hiddenReasoning)"[[:space:]]*:'
  THEN
    RAISE EXCEPTION 'invalid versioned service-analysis payload'
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
        'RECENT_LIGHTENING', 'RECENT_CHEMICAL_SERVICE', 'CHEMICAL_HISTORY_UNKNOWN',
        'ALLERGY_HISTORY_UNKNOWN', 'KNOWN_ALLERGY', 'SENSITIVITY_REPORTED',
        'VISIBLE_COMPROMISE'
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

  -- ── Required flags, by intake pack (mirror of lib/consult/safetyFlags.ts) ──
  SELECT "payload" INTO intake_payload
  FROM public."ConsultRevision"
  WHERE "consultSessionId" = NEW."consultSessionId"
    AND "kind" = 'INTAKE'
  ORDER BY "revision" DESC
  LIMIT 1;
  intake_answers := COALESCE(intake_payload -> 'answers', '{}'::jsonb);
  intake_pack := intake_payload ->> 'packId';
  flags := NEW."payload" -> 'safetyFlags';
  required_codes := ARRAY[]::TEXT[];
  lens_constraints_must_be_unknown := TRUE;
  lens_maintenance_must_be_unknown := TRUE;

  IF intake_pack = 'hair-color' THEN
    required_codes := array_append(required_codes, 'ALLERGY_HISTORY_UNKNOWN');
    IF intake_answers ->> 'prior_reaction' = 'yes' THEN required_codes := array_append(required_codes, 'PRIOR_REACTION'); END IF;
    IF intake_answers ->> 'prior_reaction' = 'not-sure' THEN required_codes := array_append(required_codes, 'REACTION_HISTORY_UNKNOWN'); END IF;
    IF intake_answers ->> 'box_dye_history' = 'within-6-months' THEN required_codes := array_append(required_codes, 'RECENT_BOX_DYE'); END IF;
    IF intake_answers ->> 'box_dye_history' = 'not-sure' OR intake_answers ->> 'prior_lightening' = 'not-sure' THEN required_codes := array_append(required_codes, 'CHEMICAL_HISTORY_UNKNOWN'); END IF;
    IF intake_answers ->> 'prior_lightening' IN ('within-3-months', '3-6-months') THEN required_codes := array_append(required_codes, 'RECENT_LIGHTENING'); END IF;
  ELSIF intake_pack = 'hair-general' THEN
    required_codes := array_append(required_codes, 'ALLERGY_HISTORY_UNKNOWN');
    IF intake_answers ->> 'prior_reaction' = 'yes' THEN required_codes := array_append(required_codes, 'PRIOR_REACTION'); END IF;
    IF intake_answers ->> 'prior_reaction' = 'not-sure' THEN required_codes := array_append(required_codes, 'REACTION_HISTORY_UNKNOWN'); END IF;
    IF intake_answers ->> 'chemical_history' = 'within-6-months' THEN required_codes := array_append(required_codes, 'RECENT_CHEMICAL_SERVICE'); END IF;
    IF intake_answers ->> 'chemical_history' = 'not-sure' OR intake_answers ->> 'prior_lightening' = 'not-sure' THEN required_codes := array_append(required_codes, 'CHEMICAL_HISTORY_UNKNOWN'); END IF;
    IF intake_answers ->> 'prior_lightening' IN ('within-3-months', '3-6-months') THEN required_codes := array_append(required_codes, 'RECENT_LIGHTENING'); END IF;
    lens_maintenance_must_be_unknown := NOT (intake_answers ? 'maintenance_tolerance');
  ELSIF intake_pack = 'general-service' THEN
    IF intake_answers ->> 'prior_reaction' = 'yes' THEN required_codes := array_append(required_codes, 'PRIOR_REACTION'); END IF;
    IF intake_answers ->> 'prior_reaction' = 'not-sure' THEN required_codes := array_append(required_codes, 'REACTION_HISTORY_UNKNOWN'); END IF;
    IF intake_answers ->> 'recent_treatment_timing' = 'within-6-months' THEN required_codes := array_append(required_codes, 'RECENT_CHEMICAL_SERVICE'); END IF;
    IF intake_answers ->> 'recent_treatment_timing' = 'not-sure' THEN required_codes := array_append(required_codes, 'CHEMICAL_HISTORY_UNKNOWN'); END IF;
    IF intake_answers ->> 'known_allergies' = 'yes' THEN required_codes := array_append(required_codes, 'KNOWN_ALLERGY'); END IF;
    IF NOT (intake_answers ? 'known_allergies') OR intake_answers ->> 'known_allergies' = 'not-sure' THEN required_codes := array_append(required_codes, 'ALLERGY_HISTORY_UNKNOWN'); END IF;
    IF intake_answers ->> 'skin_sensitivity' IN ('yes', 'sometimes') THEN required_codes := array_append(required_codes, 'SENSITIVITY_REPORTED'); END IF;
    lens_constraints_must_be_unknown := NOT (intake_answers ? 'known_allergies') OR intake_answers ->> 'known_allergies' = 'not-sure';
    lens_maintenance_must_be_unknown := NOT (intake_answers ? 'maintenance_tolerance');
  ELSE
    RAISE EXCEPTION 'analysis intake pack is not registered'
      USING ERRCODE = '23514';
  END IF;
  IF NEW."payload" #>> '{core,visibleCondition,value}' = 'POSSIBLE_COMPROMISE' THEN
    required_codes := array_append(required_codes, 'VISIBLE_COMPROMISE');
  END IF;

  -- Every required code present; every present code required (the policy
  -- supports exactly what it requires — a flag the intake cannot back is a
  -- fabricated concern).
  FOREACH code IN ARRAY required_codes LOOP
    IF NOT flags @> jsonb_build_array(jsonb_build_object('code', code)) THEN
      RAISE EXCEPTION 'analysis is missing required structured safety flags'
        USING ERRCODE = '23514';
    END IF;
  END LOOP;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(flags) AS present(flag_item)
    WHERE NOT (flag_item ->> 'code' = ANY (required_codes))
  ) THEN
    RAISE EXCEPTION 'analysis carries a safety flag the intake cannot support'
      USING ERRCODE = '23514';
  END IF;

  IF (lens_constraints_must_be_unknown
      AND NEW."payload" #>> '{serviceLens,constraints}' !~* '(unknown|not collected|not provided)')
    OR (lens_maintenance_must_be_unknown
      AND NEW."payload" #>> '{serviceLens,maintenance}' !~* '(unknown|not collected|not provided)')
  THEN
    RAISE EXCEPTION 'analysis lens claims knowledge the intake did not collect'
      USING ERRCODE = '23514';
  END IF;

  -- ── Recommendations ──────────────────────────────────────────────────────
  FOR recommendation IN
    SELECT value FROM jsonb_array_elements(NEW."payload" -> 'recommendations')
  LOOP
    IF jsonb_typeof(recommendation) IS DISTINCT FROM 'object'
      OR NOT recommendation ?& ARRAY[
        'serviceIntent', 'serviceName', 'title', 'rationale', 'achievability',
        'discussWithProfessional', 'reference'
      ]
      OR recommendation - ARRAY[
        'serviceIntent', 'serviceName', 'title', 'rationale', 'achievability',
        'discussWithProfessional', 'reference'
      ] <> '{}'::jsonb
      OR recommendation -> 'discussWithProfessional' IS DISTINCT FROM 'true'::jsonb
      OR NOT public."consult_analysis_text_valid"(recommendation -> 'title', 120)
      OR NOT public."consult_analysis_text_valid"(recommendation -> 'rationale', 320)
      OR NOT public."consult_analysis_text_valid"(recommendation -> 'achievability', 240)
      OR recommendation ->> 'serviceIntent' NOT IN (
        'SERVICE', 'CONSULTATION', 'STRAND_TEST', 'PATCH_TEST'
      )
      OR (
        recommendation ->> 'serviceIntent' = 'SERVICE'
        AND NOT public."consult_analysis_text_valid"(recommendation -> 'serviceName', 120)
      )
      OR (
        recommendation ->> 'serviceIntent' <> 'SERVICE'
        AND recommendation -> 'serviceName' IS DISTINCT FROM 'null'::jsonb
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
    -- A safety test may be filed under any of the pro's categories; every
    -- other reference stays inside the consult's own category.
    IF recommendation ->> 'serviceIntent' NOT IN ('STRAND_TEST', 'PATCH_TEST')
      AND reference ->> 'serviceCategoryId' IS DISTINCT FROM session_category_id
    THEN
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
            AND service."categoryId" = reference ->> 'serviceCategoryId'
            AND service."isActive"
            AND category."isActive"
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
          WHERE "id" = reference ->> 'serviceCategoryId'
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
    SELECT count(*) <> count(DISTINCT (recommendation_item ->> 'serviceIntent') || ':' || COALESCE(recommendation_item ->> 'serviceName', ''))
    FROM jsonb_array_elements(NEW."payload" -> 'recommendations')
      AS recommendations(recommendation_item)
  ) THEN
    RAISE EXCEPTION 'analysis recommendations must be unique'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
ALTER FUNCTION "consult_analysis_payload_guard"() SET search_path = '';
