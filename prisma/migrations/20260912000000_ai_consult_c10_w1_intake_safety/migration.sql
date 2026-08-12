-- AI Consult Phase 0 C10-W1: versioned goal/treatment intake plus bounded
-- deterministic Strand/Patch Test references. This migration does not create
-- or activate a service/offering, open exposure, or change the C5 evidence.

CREATE OR REPLACE FUNCTION "consult_intake_payload_guard"()
RETURNS TRIGGER AS $$
DECLARE
  answers JSONB;
  goal_direction_required BOOLEAN;
BEGIN
  IF NEW."kind" <> 'INTAKE' THEN
    RETURN NEW;
  END IF;

  IF jsonb_typeof(NEW."payload") IS DISTINCT FROM 'object'
    OR NEW."payload" - ARRAY[
      'packId', 'packVersion', 'schemaVersion', 'complete', 'answers'
    ] <> '{}'::jsonb
    OR NEW."payload" ->> 'packId' IS DISTINCT FROM 'hair-color'
    OR NEW."payload" -> 'packVersion' IS DISTINCT FROM '2'::jsonb
    OR NEW."payload" -> 'schemaVersion' IS DISTINCT FROM '2'::jsonb
    OR NEW."schemaVersion" <> 2
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
      'current_color', 'desired_color', 'change_scale', 'goal_direction',
      'box_dye_history', 'prior_lightening', 'henna_plant_dye_history',
      'perm_history', 'relaxer_texturizer_history',
      'keratin_smoothing_history', 'other_chemical_history',
      'last_color_service_timing', 'prior_reaction', 'event_timing', 'budget'
    ] <> '{}'::jsonb
    OR EXISTS (
      SELECT 1 FROM jsonb_each(answers) AS answer
      WHERE jsonb_typeof(answer.value) <> 'string'
    )
    OR (answers ? 'current_color' AND answers ->> 'current_color' NOT IN (
      'blonde', 'brunette', 'black', 'red', 'gray', 'other'
    ))
    OR (answers ? 'desired_color' AND answers ->> 'desired_color' NOT IN (
      'blonde', 'brunette', 'black', 'red', 'fantasy', 'not-sure'
    ))
    OR (answers ? 'change_scale' AND answers ->> 'change_scale' NOT IN (
      'subtle', 'noticeable', 'total'
    ))
    OR (answers ? 'goal_direction' AND answers ->> 'goal_direction' NOT IN (
      'lighter', 'darker', 'warmer', 'less-warm', 'brighter-pieces',
      'softer-root-contrast', 'gray-blending', 'richer-color', 'more-shine',
      'not-sure'
    ))
    OR (answers ? 'box_dye_history' AND answers ->> 'box_dye_history' NOT IN (
      'never', 'within-6-months', '6-12-months', 'over-12-months', 'not-sure'
    ))
    OR (answers ? 'prior_lightening' AND answers ->> 'prior_lightening' NOT IN (
      'never', 'within-3-months', '3-6-months', '6-12-months',
      'over-12-months', 'not-sure'
    ))
    OR EXISTS (
      SELECT 1
      FROM jsonb_each(answers) AS treatment
      WHERE treatment.key IN (
        'henna_plant_dye_history', 'perm_history',
        'relaxer_texturizer_history', 'keratin_smoothing_history',
        'other_chemical_history'
      )
        AND treatment.value #>> '{}' NOT IN (
          'never', 'within-6-months', '6-12-months', 'over-12-months',
          'not-sure'
        )
    )
    OR (answers ? 'last_color_service_timing' AND answers ->> 'last_color_service_timing' NOT IN (
      'never', 'within-4-weeks', '1-3-months', '4-6-months', '7-12-months',
      'over-12-months', 'not-sure'
    ))
    OR (answers ? 'prior_reaction' AND answers ->> 'prior_reaction' NOT IN (
      'no', 'yes', 'not-sure'
    ))
    OR (answers ? 'event_timing' AND answers ->> 'event_timing' NOT IN (
      'no-deadline', 'within-2-weeks', '2-4-weeks', '1-3-months',
      'over-3-months'
    ))
    OR (answers ? 'budget' AND answers ->> 'budget' NOT IN (
      'under-150', '150-250', '251-400', 'over-400', 'discuss-with-pro'
    ))
  THEN
    RAISE EXCEPTION 'invalid hair-color intake answers'
      USING ERRCODE = '23514';
  END IF;

  goal_direction_required :=
    answers ->> 'desired_color' = 'not-sure'
    OR answers ->> 'current_color' = answers ->> 'desired_color'
    OR answers ->> 'change_scale' = 'subtle';

  IF (NEW."payload" ->> 'complete')::boolean
    AND (
      NOT answers ?& ARRAY[
        'current_color', 'desired_color', 'change_scale', 'box_dye_history',
        'prior_lightening', 'henna_plant_dye_history', 'perm_history',
        'relaxer_texturizer_history', 'keratin_smoothing_history',
        'other_chemical_history', 'last_color_service_timing', 'prior_reaction'
      ]
      OR answers ->> 'goal_direction' = 'not-sure'
      OR (goal_direction_required AND NOT answers ? 'goal_direction')
    )
  THEN
    RAISE EXCEPTION 'complete hair-color intake is missing a resolved required answer'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
ALTER FUNCTION "consult_intake_payload_guard"() SET search_path = '';

-- Preserve C4's complete structural validator and extend only its enumerated
-- deterministic post-routing intents. Abort if the expected C4 definition is
-- absent instead of silently weakening the guard.
DO $$
DECLARE
  definition TEXT;
  updated TEXT;
BEGIN
  SELECT pg_get_functiondef('public.consult_analysis_payload_guard()'::regprocedure)
    INTO definition;
  updated := replace(
    definition,
    '''VIVID_COLOR'', ''OTHER_HAIR_COLOR''',
    '''VIVID_COLOR'', ''OTHER_HAIR_COLOR'', ''STRAND_TEST'', ''PATCH_TEST'''
  );
  IF updated = definition THEN
    RAISE EXCEPTION 'expected C4 analysis intent guard not found';
  END IF;
  EXECUTE updated;
END;
$$;
ALTER FUNCTION "consult_analysis_payload_guard"() SET search_path = '';

-- Preserve the full agreement/lifecycle/capture prerequisite function while
-- advancing only the current immutable intake version required by analysis.
DO $$
DECLARE
  definition TEXT;
  updated TEXT;
BEGIN
  SELECT pg_get_functiondef('public.consult_revision_requires_agreements()'::regprocedure)
    INTO definition;
  updated := replace(definition, 'intake."schemaVersion" = 1', 'intake."schemaVersion" = 2');
  updated := replace(updated, 'intake."payload" -> ''packVersion'' = ''1''::jsonb', 'intake."payload" -> ''packVersion'' = ''2''::jsonb');
  updated := replace(updated, 'intake."payload" -> ''schemaVersion'' = ''1''::jsonb', 'intake."payload" -> ''schemaVersion'' = ''2''::jsonb');
  IF updated = definition THEN
    RAISE EXCEPTION 'expected C4 current-intake guard not found';
  END IF;
  EXECUTE updated;
END;
$$;
ALTER FUNCTION "consult_revision_requires_agreements"() SET search_path = '';
