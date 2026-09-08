-- New packs add one upkeep answer. Validate it first, then reuse the prior
-- pack's unchanged question rules through local variables; never rewrite NEW.
DO $patch$
DECLARE definition text;
  marker text := '  answers := NEW."payload" -> ''answers'';';
BEGIN
  SELECT pg_get_functiondef('public.consult_intake_payload_guard()'::regprocedure) INTO definition;
  IF position('New look-plan upkeep packs' IN definition) > 0 THEN RETURN; END IF;
  IF position(marker IN definition) = 0 THEN RAISE EXCEPTION 'Expected intake assignment was not found'; END IF;
  definition := replace(definition, marker, marker || E'\n' || $body$
  -- New look-plan upkeep packs retain the preceding version's safety keys.
  IF (pack_id = 'hair-color' AND pack_version = '4'::jsonb)
    OR (pack_id = 'hair-general' AND pack_version = '3'::jsonb) THEN
    IF (answers ? 'maintenance_tolerance' AND COALESCE(answers->>'maintenance_tolerance','') NOT IN ('low','medium','high'))
      OR (NEW."payload"->'complete' = 'true'::jsonb AND NOT answers ? 'maintenance_tolerance')
    THEN RAISE EXCEPTION 'invalid consultation upkeep answer' USING ERRCODE = '23514'; END IF;
    pack_version := CASE WHEN pack_id = 'hair-color' THEN '3'::jsonb ELSE '2'::jsonb END;
    answers := answers - 'maintenance_tolerance';
  END IF;
$body$);
  definition := replace(definition, 'IF answers = ''{}''::jsonb', 'IF NEW."payload" -> ''answers'' = ''{}''::jsonb');
  EXECUTE definition;
END $patch$;

-- A minimum intake is a draft prerequisite, not completed history.
CREATE OR REPLACE FUNCTION public.consult_look_plan_minimum_intake(payload jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(
    ((payload->>'packId' = 'hair-color' AND payload->'packVersion' = '4'::jsonb)
      OR (payload->>'packId' = 'hair-general' AND payload->'packVersion' = '3'::jsonb))
    AND payload #>> '{answers,maintenance_tolerance}' IN ('low','medium','high'), false)
$$;

DO $patch$
DECLARE definition text;
  old_transition text := 'WHEN ''INTAKE_IN_PROGRESS'' THEN NEW."status" IN (''MEDIA_READY'', ''CONSENT_REVOKED'', ''CANCELLED'')';
  new_transition text := 'WHEN ''INTAKE_IN_PROGRESS'' THEN NEW."status" IN (''MEDIA_READY'', ''CONSENT_REVOKED'', ''CANCELLED'') OR (NEW."status" = ''ANALYSIS_PENDING'' AND EXISTS (SELECT 1 FROM public."ServiceCategory" c WHERE c.id = NEW."serviceCategoryId" AND c."consultFamily" = ''HAIR'' AND c."isActive") AND public.consult_look_plan_minimum_intake((SELECT r.payload FROM public."ConsultRevision" r WHERE r."consultSessionId" = NEW.id AND r.kind = ''INTAKE'' ORDER BY r.revision DESC LIMIT 1)))';
BEGIN
  SELECT pg_get_functiondef('public.consult_lifecycle_guard()'::regprocedure) INTO definition;
  IF position(new_transition IN definition) > 0 THEN RETURN; END IF;
  IF position(old_transition IN definition) = 0 THEN RAISE EXCEPTION 'Expected intake lifecycle transition was not found'; END IF;
  definition := replace(definition, old_transition, new_transition);
  definition := replace(definition, 'IF OLD."status" = ''MEDIA_READY'' AND NEW."status" = ''ANALYSIS_PENDING'' THEN',
    'IF OLD."status" IN (''MEDIA_READY'', ''INTAKE_IN_PROGRESS'') AND NEW."status" = ''ANALYSIS_PENDING'' THEN');
  EXECUTE definition;
END $patch$;

DO $patch$
DECLARE definition text;
  old_intake text := 'AND intake."payload" -> ''complete'' = ''true''::jsonb;';
  new_intake text := 'AND (intake."payload" -> ''complete'' = ''true''::jsonb OR (NEW."schemaVersion" = 6 AND NEW."payload" #> ''{lookPlan,provisional}'' = ''true''::jsonb AND public.consult_look_plan_minimum_intake(intake."payload")));';
BEGIN
  SELECT pg_get_functiondef('public.consult_revision_requires_agreements()'::regprocedure) INTO definition;
  IF position(new_intake IN definition) > 0 THEN RETURN; END IF;
  IF position(old_intake IN definition) = 0 THEN RAISE EXCEPTION 'Expected analysis intake prerequisite was not found'; END IF;
  definition := replace(definition, old_intake, new_intake);
  EXECUTE definition;
  SELECT pg_get_functiondef('public.consult_analysis_payload_guard()'::regprocedure) INTO definition;
  definition := replace(definition, 'lens_maintenance_must_be_unknown := TRUE;',
    'lens_maintenance_must_be_unknown := NOT (intake_answers ? ''maintenance_tolerance'');');
  EXECUTE definition;
END $patch$;
