-- P4a: analysis schema v4 / prompt `service-analysis-v5`.
--
-- Two changes travel together, and both are the reason the version moves:
--
--   1. `runConsultAnalysis` is now TWO provider calls. Schema v3 never
--      compiled — the structured-output grammar has a size budget and the
--      schema was about 2.4x over it, so every analysis 400'd on its first
--      request and NO analysis revision has ever been written from a live
--      model. The stored payload's top-level keys are unchanged; the split is
--      entirely on the provider side, so nothing in this guard cares which
--      call produced which half.
--   2. `core.currentLevel: { min, max }` becomes `core.baseLevel` and
--      `core.lightestLevel`, two ordinary observations valued on the salon
--      level scale (LEVEL_1..LEVEL_10 or UNKNOWN). The old pair never said
--      whether it meant dark-to-light or a spread of uncertainty; the guard
--      read it as two integers in 1..10, and the client screen rendered it as
--      "Level 5-7", which reads as the former. Named fields, one meaning each.
--
-- 🔴 `consult_analysis_payload_guard` PINS the prompt version an ANALYSIS
-- revision may be written under. Bumping the TypeScript constant alone makes
-- every analysis insert raise
--   23514 "invalid versioned service-analysis payload"
-- at the very end of the provider calls, so the client pays for the analysis
-- and then gets a 500 (20261007000002 records the same trap on v4).
--
-- A single value, not a set: an analysis prompt version is only ever checked
-- at INSERT, so no earlier row needs to keep passing. A client holding a v4
-- state is refused earlier and more clearly by `validInput`, with
-- ANALYSIS_PROMPT_VERSION_MISMATCH.
--
-- Swept before writing this file against the LIVE definitions in a database
-- with the whole chain deployed (the local tovis_test, 2026-09-04), not
-- reconstructed from the migration files — later migrations rewrite these
-- functions in place with pg_get_functiondef + replace, so the current body
-- only exists in a database. `prokind = 'f'` because pg_get_functiondef throws
-- on aggregates:
--
--   SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public' AND p.prokind = 'f'
--      AND pg_get_functiondef(p.oid) LIKE '%service-analysis-%';
--   -- consult_analysis_payload_guard, and nothing else
--   SELECT conname FROM pg_constraint
--    WHERE pg_get_constraintdef(oid) LIKE '%service-analysis-%';
--   -- no rows
--
-- The same two sweeps for '%currentLevel%' named this guard alone and no
-- constraint, so this file is the only place either pin lives.
--
-- The guard is re-issued IN FULL (current definition = 20261004000000 as
-- patched by 20261007000002) rather than string-replaced: the level block is a
-- twenty-line disjunction being replaced by two function calls plus an
-- ordering rule, and a targeted `replace` over that much SQL is how a drifted
-- definition silently half-applies.
--
-- Forward-only is correct and costs nothing: production holds 0 ANALYSIS
-- revisions (the schema never compiled, so none could ever be written), so
-- there is no v3 row for the new shape to invalidate.

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
  base_level TEXT;
  lightest_level TEXT;
BEGIN
  IF NEW."kind" <> 'ANALYSIS' THEN
    RETURN NEW;
  END IF;

  SELECT "status", "serviceCategoryId", "professionalId"
    INTO session_status, session_category_id, session_professional_id
  FROM public."ConsultSession"
  WHERE "id" = NEW."consultSessionId";

  IF session_status <> 'ANALYZING'
    OR NEW."schemaVersion" <> 4
    OR NEW."promptVersion" IS DISTINCT FROM 'service-analysis-v5'
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
      'baseLevel', 'lightestLevel', 'currentTone', 'visibleCondition', 'density', 'texture'
    ]
    OR (NEW."payload" -> 'core') - ARRAY[
      'baseLevel', 'lightestLevel', 'currentTone', 'visibleCondition', 'density', 'texture'
    ] <> '{}'::jsonb
    -- The two levels are ordinary observations now, so they get the ordinary
    -- validator: shape, vocabulary, and the UNKNOWN-cites-nothing rule.
    OR NOT public."consult_analysis_observation_valid"(
      NEW."payload" #> '{core,baseLevel}',
      ARRAY[
        'LEVEL_1', 'LEVEL_2', 'LEVEL_3', 'LEVEL_4', 'LEVEL_5',
        'LEVEL_6', 'LEVEL_7', 'LEVEL_8', 'LEVEL_9', 'LEVEL_10', 'UNKNOWN'
      ]
    )
    OR NOT public."consult_analysis_observation_valid"(
      NEW."payload" #> '{core,lightestLevel}',
      ARRAY[
        'LEVEL_1', 'LEVEL_2', 'LEVEL_3', 'LEVEL_4', 'LEVEL_5',
        'LEVEL_6', 'LEVEL_7', 'LEVEL_8', 'LEVEL_9', 'LEVEL_10', 'UNKNOWN'
      ]
    )
    -- ...and, unlike every other observation, they may cite only HAIR views. A
    -- level read off a face view is not a level.
    OR EXISTS (
      SELECT 1
      FROM jsonb_array_elements_text(NEW."payload" #> '{core,baseLevel,evidence}')
        AS label(name)
      WHERE label.name NOT IN ('hair_back', 'hair_left', 'hair_right', 'hair_crown')
    )
    OR EXISTS (
      SELECT 1
      FROM jsonb_array_elements_text(NEW."payload" #> '{core,lightestLevel,evidence}')
        AS label(name)
      WHERE label.name NOT IN ('hair_back', 'hair_left', 'hair_right', 'hair_crown')
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

  -- The one relationship the level scale forbids. Either end being UNKNOWN is
  -- simply unobserved and passes; a base LIGHTER than the lightest cannot be
  -- true of any head of hair. Mirrors consultHairLevelPairIsOrdered().
  base_level := NEW."payload" #>> '{core,baseLevel,value}';
  lightest_level := NEW."payload" #>> '{core,lightestLevel,value}';
  IF base_level <> 'UNKNOWN' AND lightest_level <> 'UNKNOWN'
    AND split_part(base_level, '_', 2)::int > split_part(lightest_level, '_', 2)::int
  THEN
    RAISE EXCEPTION 'analysis base level is lighter than its lightest level'
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
