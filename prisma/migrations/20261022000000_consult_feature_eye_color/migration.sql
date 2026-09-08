-- Expand-only: retain the existing writer while the new deployment builds.
-- Each prompt remains bound to its own exact profile shape.
DO $patch$
DECLARE definition text;
  old_pin text := 'OR NEW."schemaVersion" <> 4' || E'\n    OR NEW."promptVersion" IS DISTINCT FROM ''service-analysis-v5''';
  new_pin text := 'OR NOT ((NEW."schemaVersion" = 4 AND NEW."promptVersion" IS NOT DISTINCT FROM ''service-analysis-v5'') OR (NEW."schemaVersion" = 5 AND NEW."promptVersion" IS NOT DISTINCT FROM ''service-analysis-v6''))';
  profile_tail text := '''eyeSpacing'', ''browDensity'', ''browShape''' || E'\n    ]';
  new_tail text := '''eyeSpacing'', ''browDensity'', ''browShape''' || E'\n    ] || CASE WHEN NEW."schemaVersion" = 5 THEN ARRAY[''eyeColor''] ELSE ARRAY[]::text[] END';
BEGIN
  SELECT pg_get_functiondef('public.consult_analysis_payload_guard()'::regprocedure) INTO definition;
  IF position(new_pin IN definition) > 0 THEN RETURN; END IF;
  IF position(old_pin IN definition) = 0 OR position(profile_tail IN definition) = 0 THEN
    RAISE EXCEPTION 'Expected consultation profile version guard was not found';
  END IF;
  definition := replace(definition, old_pin, new_pin);
  definition := replace(definition, '(NEW."payload" -> ''profile'') ?& ARRAY[', '(NEW."payload" -> ''profile'') ?& (ARRAY[');
  definition := replace(definition, '(NEW."payload" -> ''profile'') - ARRAY[', '(NEW."payload" -> ''profile'') - (ARRAY[');
  definition := replace(definition, profile_tail, new_tail || ')');
  definition := replace(definition, 'OR jsonb_typeof(NEW."payload" -> ''styleDirections'')',
    'OR (NEW."schemaVersion" = 5 AND (NOT public.consult_analysis_observation_valid(NEW."payload" #> ''{profile,eyeColor}'', ARRAY[''BROWN'', ''BLUE'', ''GREEN'', ''HAZEL'', ''GRAY'', ''MIXED'', ''UNKNOWN'']) OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(NEW."payload" #> ''{profile,eyeColor,evidence}'') e(value) WHERE e.value NOT IN (''face_front'', ''face_side'', ''eyes_closeup'')))) OR jsonb_typeof(NEW."payload" -> ''styleDirections'')');
  EXECUTE definition;
END
$patch$;
