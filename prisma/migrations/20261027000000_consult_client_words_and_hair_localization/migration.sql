-- Bounded client-authored words; historical immutable revisions are unchanged.
DO $migration$
DECLARE definition text; previous text;
BEGIN
  SELECT pg_get_functiondef('public.consult_inspiration_payload_guard()'::regprocedure) INTO definition;
  previous := definition;
  definition := replace(definition,
    'OR NEW."payload" - ARRAY[''packId'',''packVersion'',''schemaVersion'',''source'',''inspirationId'',''complete'',''answers'',''catalogGuidance'']',
    'OR NEW."payload" - ARRAY[''packId'',''packVersion'',''schemaVersion'',''source'',''inspirationId'',''complete'',''answers'',''catalogGuidance'',''textAnswers'']');
  IF definition = previous THEN RAISE EXCEPTION 'inspiration payload guard shape changed'; END IF;
  -- Client descriptions may name face-framing hair. Model/enum fields retain
  -- their prohibited-trait guard; notes never become model observations.
  definition := replace(definition, 'NEW."payload"::text ~*', '(NEW."payload" - ''textAnswers'')::text ~*');
  previous := definition;
  definition := replace(definition, 'OR jsonb_array_length(answer.value) NOT BETWEEN 1 AND 16',
    'OR jsonb_array_length(answer.value) > 16
          OR (jsonb_array_length(answer.value) = 0 AND NOT (COALESCE(NEW."payload" -> ''textAnswers'', ''{}''::jsonb) ? answer.key))');
  IF definition = previous THEN RAISE EXCEPTION 'inspiration answer guard shape changed'; END IF;
  previous := definition;
  definition := replace(definition, 'IF NEW."schemaVersion" = 2 THEN',
    'IF NEW."schemaVersion" = 2 THEN
    IF NEW."payload" ? ''textAnswers'' THEN
      IF jsonb_typeof(NEW."payload" -> ''textAnswers'') IS DISTINCT FROM ''object''
        OR jsonb_typeof(NEW."payload" -> ''answers'') IS DISTINCT FROM ''object'' THEN
        RAISE EXCEPTION ''invalid client inspiration words'' USING ERRCODE = ''23514'';
      END IF;
      IF (SELECT count(*) FROM jsonb_object_keys(NEW."payload" -> ''textAnswers'')) > 32
        OR EXISTS (SELECT 1 FROM jsonb_each(NEW."payload" -> ''textAnswers'') note(key, value)
          WHERE note.key !~ ''^[a-z][a-z0-9_]{0,63}$''
            OR NOT (NEW."payload" -> ''answers'' ? note.key)
            OR jsonb_typeof(note.value) IS DISTINCT FROM ''string''
            OR length(note.value #>> ''{}'') NOT BETWEEN 1 AND 600
            OR btrim(note.value #>> ''{}'') <> (note.value #>> ''{}'')) THEN
        RAISE EXCEPTION ''invalid client inspiration words'' USING ERRCODE = ''23514'';
      END IF;
    END IF;');
  IF definition = previous THEN RAISE EXCEPTION 'inspiration v2 guard missing'; END IF;
  EXECUTE definition;

  SELECT pg_get_functiondef('public.consult_inspiration_analysis_payload_guard()'::regprocedure) INTO definition;
  previous := definition;
  definition := replace(definition,
    'NEW."promptVersion" IS DISTINCT FROM ''inspiration-hair-color-v2''',
    '(NEW."promptVersion" IS NULL OR NEW."promptVersion" NOT IN (''inspiration-hair-color-v2'', ''inspiration-hair-color-v3''))');
  IF definition = previous THEN RAISE EXCEPTION 'inspiration prompt guard changed'; END IF;
  EXECUTE definition;
END
$migration$;
