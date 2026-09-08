-- Expand-only: schema 4/v5 and 5/v6 remain valid during the batched release.
-- New snapshots are immutable analysis data, never booking authorization.
CREATE OR REPLACE FUNCTION public.consult_look_plan_snapshot_valid(plan jsonb, analysis jsonb, professional_id text, category_id text)
RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE path jsonb; visit jsonb; step jsonb; field text; observed jsonb;
BEGIN
  IF jsonb_typeof(plan) IS DISTINCT FROM 'object' THEN RETURN false; END IF;
  IF NOT plan ?& ARRAY['schemaVersion','tier','status','provisional','summary','nextStep','paths']
    OR plan - ARRAY['schemaVersion','tier','status','provisional','summary','nextStep','paths'] <> '{}'::jsonb
    OR plan->'schemaVersion' IS DISTINCT FROM '1'::jsonb
    OR COALESCE(plan->>'tier','') NOT IN ('EXACT','CLOSE','TOWARD')
    OR COALESCE(plan->>'status','') NOT IN ('READY_TO_CHOOSE','NEEDS_INPUT','PRO_REVIEW','NO_OFFERING')
    OR plan->'provisional' IS DISTINCT FROM to_jsonb(plan->>'status' <> 'READY_TO_CHOOSE')
    OR NOT public.consult_analysis_text_valid(plan->'summary',400)
    OR NOT public.consult_analysis_text_valid(plan->'nextStep',320)
    OR jsonb_typeof(plan->'paths') IS DISTINCT FROM 'array'
    OR NOT EXISTS (SELECT 1 FROM public."ServiceCategory" WHERE id = category_id AND "consultFamily" = 'HAIR' AND "isActive")
  THEN RETURN false; END IF;
  IF jsonb_array_length(plan->'paths') > 3
    OR (plan->>'status' = 'READY_TO_CHOOSE' AND jsonb_array_length(plan->'paths') = 0)
    OR (plan->>'status' IN ('PRO_REVIEW','NO_OFFERING') AND jsonb_array_length(plan->'paths') <> 0)
  THEN RETURN false; END IF;
  FOR path IN SELECT value FROM jsonb_array_elements(plan->'paths') LOOP
    IF jsonb_typeof(path) IS DISTINCT FROM 'object'
      OR NOT path ?& ARRAY['title','whyThisWorksForYou','featureEvidence','sessionCount','visits']
      OR path - ARRAY['title','whyThisWorksForYou','featureEvidence','sessionCount','visits'] <> '{}'::jsonb
      OR NOT public.consult_analysis_text_valid(path->'title',100)
      OR NOT public.consult_analysis_text_valid(path->'whyThisWorksForYou',320)
      OR jsonb_typeof(path->'visits') IS DISTINCT FROM 'array'
      OR jsonb_typeof(path->'featureEvidence') IS DISTINCT FROM 'array'
    THEN RETURN false; END IF;
    IF jsonb_array_length(path->'visits') NOT BETWEEN 1 AND 8
      OR path->'sessionCount' IS DISTINCT FROM to_jsonb(jsonb_array_length(path->'visits'))
      OR (SELECT count(*) <> count(DISTINCT value) FROM jsonb_array_elements(path->'featureEvidence'))
    THEN RETURN false; END IF;
    FOR field IN SELECT value FROM jsonb_array_elements_text(path->'featureEvidence') LOOP
      IF field !~ '^(profile|core)\.[A-Za-z]+$' THEN RETURN false; END IF;
      observed := analysis #> string_to_array(field, '.');
      IF observed IS NULL OR COALESCE(observed->>'value','UNKNOWN') = 'UNKNOWN'
        OR COALESCE((observed #>> '{confidence,min}')::numeric,0) < 0.5
        OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements_text(observed->'evidence') e(value) WHERE e.value <> 'intake')
      THEN RETURN false; END IF;
    END LOOP;
    FOR visit IN SELECT value FROM jsonb_array_elements(path->'visits') LOOP
      IF jsonb_typeof(visit) IS DISTINCT FROM 'object' OR NOT visit ? 'steps'
        OR visit - 'steps' <> '{}'::jsonb OR jsonb_typeof(visit->'steps') IS DISTINCT FROM 'array'
      THEN RETURN false; END IF;
      IF jsonb_array_length(visit->'steps') NOT BETWEEN 1 AND 6
        OR (SELECT count(*) <> count(DISTINCT value->>'serviceId') FROM jsonb_array_elements(visit->'steps'))
      THEN RETURN false; END IF;
      FOR step IN SELECT value FROM jsonb_array_elements(visit->'steps') LOOP
        IF jsonb_typeof(step) IS DISTINCT FROM 'object'
          OR NOT step ?& ARRAY['serviceId','offeringId','serviceCategoryId','serviceName']
          OR step - ARRAY['serviceId','offeringId','serviceCategoryId','serviceName'] <> '{}'::jsonb
          OR NOT EXISTS (
            SELECT 1 FROM public."ProfessionalServiceOffering" o
            JOIN public."Service" s ON s.id = o."serviceId"
            JOIN public."ServiceCategory" c ON c.id = s."categoryId"
            WHERE o.id = step->>'offeringId' AND o."professionalId" = professional_id
              AND s.id = step->>'serviceId' AND s.name = step->>'serviceName'
              AND c.id = step->>'serviceCategoryId' AND c."consultFamily" = 'HAIR'
              AND o."isActive" AND s."isActive" AND c."isActive"
              AND (o."offersInSalon" OR o."offersMobile")
          )
        THEN RETURN false; END IF;
      END LOOP;
    END LOOP;
  END LOOP;
  IF (SELECT count(*) <> count(DISTINCT lower(value->>'title')) FROM jsonb_array_elements(plan->'paths')) THEN RETURN false; END IF;
  RETURN true;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN RETURN false;
END $$;

DO $patch$
DECLARE definition text;
  old_pin text := 'OR NOT ((NEW."schemaVersion" = 4 AND NEW."promptVersion" IS NOT DISTINCT FROM ''service-analysis-v5'') OR (NEW."schemaVersion" = 5 AND NEW."promptVersion" IS NOT DISTINCT FROM ''service-analysis-v6''))';
  new_pin text := 'OR NOT ((NEW."schemaVersion" = 4 AND NEW."promptVersion" IS NOT DISTINCT FROM ''service-analysis-v5'') OR (NEW."schemaVersion" = 5 AND NEW."promptVersion" IS NOT DISTINCT FROM ''service-analysis-v6'') OR (NEW."schemaVersion" = 6 AND NEW."promptVersion" IS NOT DISTINCT FROM ''service-analysis-v7''))';
  old_keys text := 'OR NEW."payload" - ARRAY[' || E'\n      ''profile'', ''styleDirections'', ''core'', ''serviceLens'', ''safetyFlags'', ''recommendations''\n    ] <> ''{}''::jsonb';
  new_keys text := 'OR NEW."payload" - (ARRAY[' || E'\n      ''profile'', ''styleDirections'', ''core'', ''serviceLens'', ''safetyFlags'', ''recommendations''\n    ] || CASE WHEN NEW."schemaVersion" = 6 THEN ARRAY[''lookPlan''] ELSE ARRAY[]::text[] END) <> ''{}''::jsonb';
  old_scope text := 'AND reference ->> ''serviceCategoryId'' IS DISTINCT FROM session_category_id';
  new_scope text := 'AND reference ->> ''serviceCategoryId'' IS DISTINCT FROM session_category_id AND NOT (NEW."schemaVersion" = 6 AND NEW."payload" ? ''lookPlan'' AND EXISTS (SELECT 1 FROM public."ServiceCategory" c WHERE c.id = reference ->> ''serviceCategoryId'' AND c."consultFamily" = ''HAIR'' AND c."isActive"))';
BEGIN
  SELECT pg_get_functiondef('public.consult_analysis_payload_guard()'::regprocedure) INTO definition;
  IF position(new_pin IN definition) > 0 THEN RETURN; END IF;
  IF position(old_pin IN definition) = 0 OR position(old_keys IN definition) = 0 OR position(old_scope IN definition) = 0 THEN
    RAISE EXCEPTION 'Expected consultation analysis version/shape/scope guard was not found';
  END IF;
  -- Expand eyeColor checks before inserting the exact writer-version pins.
  definition := replace(definition, 'NEW."schemaVersion" = 5', 'NEW."schemaVersion" >= 5');
  definition := replace(definition, replace(old_pin, 'NEW."schemaVersion" = 5', 'NEW."schemaVersion" >= 5'), new_pin);
  definition := replace(definition, old_keys, new_keys);
  definition := replace(definition, old_scope, new_scope);
  definition := replace(definition, '  -- The one relationship the level scale forbids.',
    E'  IF NEW."payload" ? ''lookPlan'' AND NOT public.consult_look_plan_snapshot_valid(NEW."payload"->''lookPlan'', NEW."payload", session_professional_id, session_category_id) THEN\n    RAISE EXCEPTION ''invalid consultation look plan snapshot'' USING ERRCODE = ''23514'';\n  END IF;\n\n  -- The one relationship the level scale forbids.');
  EXECUTE definition;
END $patch$;
