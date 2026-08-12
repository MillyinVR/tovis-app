-- C10-W1 adds required treatment-history answers to the immutable intake. The
-- deterministic pro brief already renders each normalized answer, so widen its
-- bounded client-intake array without changing any other brief invariant.

DO $$
DECLARE
  definition TEXT;
  updated TEXT;
BEGIN
  SELECT pg_get_functiondef('public.consult_brief_payload_guard()'::regprocedure)
    INTO definition;
  updated := replace(
    definition,
    'jsonb_array_length(NEW."payload" -> ''clientIntake'') NOT BETWEEN 1 AND 9',
    'jsonb_array_length(NEW."payload" -> ''clientIntake'') NOT BETWEEN 1 AND 15'
  );
  IF updated = definition THEN
    RAISE EXCEPTION 'expected C6 client-intake bound not found';
  END IF;
  EXECUTE updated;
END;
$$;
ALTER FUNCTION "consult_brief_payload_guard"() SET search_path = '';
