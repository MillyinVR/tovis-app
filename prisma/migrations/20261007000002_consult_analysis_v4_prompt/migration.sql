-- P4: the analysis prompt moves to `service-analysis-v4`.
--
-- 🔴 `consult_analysis_payload_guard` PINS the prompt version an ANALYSIS
-- revision may be written under. Bumping the TypeScript constant alone makes
-- every analysis insert raise
--   23514 "invalid versioned service-analysis payload"
-- at the very end of a 90-second provider call, so the client pays for the
-- analysis and then gets a 500. (The same trap the capture-warning slice hit
-- in 20261006000000; this is its analysis-side twin. Verified by running the
-- look-anchored integration flow before this file existed — it failed exactly
-- there.)
--
-- Only the prompt version moves. The OUTPUT schema is unchanged: v4 is new
-- INPUT (the inspiration read, the client's words about it, and a per-view
-- colour warning), so `schemaVersion` stays 3 and every shape rule in this
-- guard stays exactly as it was.
--
-- A single value, not a set: unlike a capture's stored quality verdict, an
-- analysis prompt version is only ever checked at INSERT, so there is no
-- earlier row that needs to keep passing. A client holding a v3 state is
-- refused earlier and more clearly, by `validInput`, with
-- ANALYSIS_PROMPT_VERSION_MISMATCH.
--
-- Confirmed with pg_get_functiondef that this guard is the ONLY database
-- object naming the prompt version — no CHECK constraint and no other
-- function does.

DO $$
DECLARE
  definition TEXT;
  updated TEXT;
BEGIN
  SELECT pg_get_functiondef('public.consult_analysis_payload_guard()'::regprocedure)
    INTO definition;

  updated := replace(
    definition,
    'NEW."promptVersion" IS DISTINCT FROM ''service-analysis-v3''',
    'NEW."promptVersion" IS DISTINCT FROM ''service-analysis-v4'''
  );
  IF position('service-analysis-v4' in updated) = 0
    OR position('service-analysis-v3' in updated) > 0
  THEN
    RAISE EXCEPTION 'expected analysis prompt-version pin not found';
  END IF;

  EXECUTE updated;
END;
$$;
ALTER FUNCTION "consult_analysis_payload_guard"() SET search_path = '';
