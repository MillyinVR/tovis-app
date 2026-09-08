DO $patch$
DECLARE definition text;
BEGIN
  SELECT pg_get_functiondef('public.consult_look_brief_version_guard()'::regprocedure) INTO definition;
  definition := replace(definition,
    'IF NOT public.consult_look_plan_snapshot_valid(NEW."professionalPlan", source_payload,',
    'IF (NEW."createdByActorType" = ''PROFESSIONAL'' AND NOT public.consult_look_plan_snapshot_valid(NEW."professionalPlan", source_payload,');
  definition := replace(definition,
    '(SELECT "serviceCategoryId" FROM public."ConsultSession" WHERE id = NEW."consultSessionId"))',
    '(SELECT "serviceCategoryId" FROM public."ConsultSession" WHERE id = NEW."consultSessionId")))');
  EXECUTE definition;
  SELECT pg_get_functiondef('public.consult_look_brief_acknowledgment_guard()'::regprocedure) INTO definition;
  definition := replace(definition, 'IF NEW."awaitingAnalysis" OR NEW."selectedPathIndex" IS NULL',
    'IF NEW."awaitingAnalysis" OR NEW."invalidatedProfessionalPlan" IS NOT NULL OR jsonb_array_length(NEW."invalidatedAdjustments") > 0 OR NEW."selectedPathIndex" IS NULL');
  EXECUTE definition;
END $patch$;
