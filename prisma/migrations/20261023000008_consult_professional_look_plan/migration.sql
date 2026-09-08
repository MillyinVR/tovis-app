ALTER TABLE public."ConsultLookBriefVersion"
  ADD COLUMN "professionalPlan" jsonb,
  ADD COLUMN "professionalPlanReason" varchar(400),
  ADD COLUMN "invalidatedProfessionalPlan" jsonb;

-- The original AI artifact remains immutable. Professional decisions live on
-- a brief version and must resolve to this pro's current active hair offerings.
DO $patch$
DECLARE definition text; marker text;
BEGIN
  SELECT pg_get_functiondef('public.consult_look_brief_version_guard()'::regprocedure) INTO definition;
  marker := '  IF NEW.version <> next_version';
  IF position(marker IN definition) = 0 THEN RAISE EXCEPTION 'Missing look brief version guard marker'; END IF;
  definition := replace(definition, marker, $body$
  IF NEW."professionalPlan" IS NOT NULL THEN
    IF NOT public.consult_look_plan_snapshot_valid(NEW."professionalPlan", source_payload,
      (SELECT "professionalId" FROM public."ConsultSession" WHERE id = NEW."consultSessionId"),
      (SELECT "serviceCategoryId" FROM public."ConsultSession" WHERE id = NEW."consultSessionId"))
      OR NEW."professionalPlan"->>'status' <> 'READY_TO_CHOOSE'
      OR COALESCE(length(trim(NEW."professionalPlanReason")),0) = 0
      OR (NEW."createdByActorType" <> 'PROFESSIONAL' AND NOT EXISTS (
        SELECT 1 FROM public."ConsultLookBriefVersion" prior
        WHERE prior."consultSessionId" = NEW."consultSessionId" AND prior.version = NEW.version - 1
          AND prior."sourceAnalysisRevisionId" = NEW."sourceAnalysisRevisionId"
          AND prior."professionalPlan" = NEW."professionalPlan"
          AND prior."professionalPlanReason" = NEW."professionalPlanReason"))
    THEN RAISE EXCEPTION 'a professional look requires an owned menu and attributed review' USING ERRCODE = '23514'; END IF;
    source_payload := jsonb_set(source_payload, '{lookPlan}', NEW."professionalPlan");
  END IF;
  IF NEW.version <> next_version
$body$);
  EXECUTE definition;
  SELECT pg_get_functiondef('public.consult_look_estimate_lines_valid(text)'::regprocedure) INTO definition;
  marker := 'SELECT payload #> ARRAY[''lookPlan'',''paths'',brief."selectedPathIndex"::text,''visits'',''0'',''steps'']';
  IF position(marker IN definition) = 0 THEN RAISE EXCEPTION 'Missing look estimate plan marker'; END IF;
  definition := replace(definition, marker,
    'SELECT coalesce(brief."professionalPlan", payload->''lookPlan'') #> ARRAY[''paths'',brief."selectedPathIndex"::text,''visits'',''0'',''steps'']');
  EXECUTE definition;
END $patch$;
