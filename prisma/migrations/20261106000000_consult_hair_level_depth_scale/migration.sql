-- Prose-only prompt update: both readers are now told what the ten salon
-- depth levels MEAN (lib/consult/hairLevel.ts), instead of only "1 is black
-- and 10 is the lightest blonde" — and, for the capture analysis, instead of
-- nothing at all.
--
-- Nothing about either stored shape changes, so both schema versions stay put
-- and every existing row keeps its meaning. Only the version that names the
-- words moves: inspiration v4 -> v5, analysis v11 -> v12.
--
-- 🔴 PATCHED, never re-issued. Both guards have been amended in place by
-- earlier migrations, so rebuilding either body from the repo's files would
-- silently drop those amendments. Each block reads the LIVE definition, checks
-- the expected pin is present, and replaces one substring — the same shape as
-- 20261024000006_consult_client_language.

-- 1. The look-plan analysis guard: allow service-analysis-v12 on schema 6.
--
-- 🔴 The pin appears TWICE in the live body and BOTH must move. Verified
-- against production, 2026-09-13:
--   * the schemaVersion-6 promptVersion allowlist;
--   * the eye-colour evidence rule, which forces
--     profile.eyeColor.evidence into ('face_front','face_side','eyes_closeup')
--     UNLESS the prompt version is v9/v10/v11. That exemption is what #1157
--     added so a selfie-only analysis could read eye colour from
--     `early_photo` — which is exactly what the 2026-09-13 production consult
--     did. Adding v12 to the allowlist alone would re-break that fixed bug on
--     the first real consult.
-- `replace()` is global, so one call moves both. That is deliberate here, not
-- incidental: check the count before assuming it stays true of a later pin.
DO $patch$
DECLARE
  definition text;
  old_pin text := 'NEW."promptVersion" IS NOT DISTINCT FROM ''service-analysis-v11''';
  new_pin text := 'NEW."promptVersion" IS NOT DISTINCT FROM ''service-analysis-v11'' OR NEW."promptVersion" IS NOT DISTINCT FROM ''service-analysis-v12''';
BEGIN
  SELECT pg_get_functiondef('public.consult_analysis_payload_guard()'::regprocedure) INTO definition;
  IF position(new_pin IN definition) > 0 THEN RETURN; END IF;
  IF position(old_pin IN definition) = 0 THEN
    RAISE EXCEPTION 'Expected consultation analysis v11 prompt pin was not found';
  END IF;
  EXECUTE replace(definition, old_pin, new_pin);
END $patch$;

-- 2. The inspiration-reading guard: accept v4 OR v5 on schema 4.
--
-- 🔴 The NULL arm is deliberate. The pin being replaced is `IS DISTINCT FROM`,
-- which REFUSES a NULL promptVersion (NULL IS DISTINCT FROM 'x' is true). A
-- bare `NOT IN (...)` would evaluate to NULL for a NULL version and therefore
-- stop refusing it — a hole opened by a change meant only to widen the set.
-- The explicit `IS NULL` keeps the old behaviour, and matches how this same
-- function already spells its v2/v3 arm.
DO $patch$
DECLARE
  definition text;
  old_pin text := 'NEW."promptVersion" IS DISTINCT FROM ''inspiration-hair-color-v4''';
  new_pin text := '(NEW."promptVersion" IS NULL OR NEW."promptVersion" NOT IN (''inspiration-hair-color-v4'', ''inspiration-hair-color-v5''))';
BEGIN
  SELECT pg_get_functiondef('public.consult_inspiration_analysis_payload_guard()'::regprocedure) INTO definition;
  IF position(new_pin IN definition) > 0 THEN RETURN; END IF;
  IF position(old_pin IN definition) = 0 THEN
    RAISE EXCEPTION 'Expected consultation inspiration v4 prompt pin was not found';
  END IF;
  EXECUTE replace(definition, old_pin, new_pin);
END $patch$;
