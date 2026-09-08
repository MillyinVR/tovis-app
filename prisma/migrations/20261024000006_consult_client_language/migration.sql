-- Prose-only prompt update. Accept both writers during a rolling release;
-- keep the existing schema, evidence, history and safety guards intact.
DO $patch$
DECLARE
  definition text;
  old_pin text := '(NEW."schemaVersion" = 6 AND NEW."promptVersion" IS NOT DISTINCT FROM ''service-analysis-v7'')';
  new_pin text := '(NEW."schemaVersion" = 6 AND (NEW."promptVersion" IS NOT DISTINCT FROM ''service-analysis-v7'' OR NEW."promptVersion" IS NOT DISTINCT FROM ''service-analysis-v8''))';
BEGIN
  SELECT pg_get_functiondef('public.consult_analysis_payload_guard()'::regprocedure) INTO definition;
  IF position(new_pin IN definition) > 0 THEN RETURN; END IF;
  IF position(old_pin IN definition) = 0 THEN
    RAISE EXCEPTION 'Expected consultation analysis v7 prompt guard was not found';
  END IF;
  EXECUTE replace(definition, old_pin, new_pin);
END $patch$;
