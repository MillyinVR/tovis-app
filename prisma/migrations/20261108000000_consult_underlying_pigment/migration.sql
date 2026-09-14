-- Prose-only prompt update: the look-plan instructions now carry the
-- UNDERLYING PIGMENT each level exposes and the complement that cancels it
-- (lib/consult/hairLevel.ts). The plan could already size a lift but had no
-- way to price its chemistry. Nothing about the stored shape changes, so the
-- schema version stays at 6 and every existing row keeps its meaning. Only the
-- version that names the words moves: analysis v12 -> v13.
--
-- The inspiration read is deliberately NOT bumped. Underlying pigment is a
-- fact about LIFTING, not something readable from a photograph of finished
-- hair, so those words are not in that prompt and its version must not move.
--
-- 🔴 PATCHED, never re-issued. This guard has been amended in place by several
-- earlier migrations, so rebuilding its body from the repo's files would
-- silently drop those amendments. The block reads the LIVE definition, checks
-- the expected pin is present, and replaces one substring — the same shape as
-- 20261106000000_consult_hair_level_depth_scale and
-- 20261024000006_consult_client_language.

-- The look-plan analysis guard: allow service-analysis-v13 on schema 6.
--
-- 🔴 The pin appears TWICE in the live body and BOTH must move. Verified by
-- dumping pg_get_functiondef on 2026-09-14 (2 occurrences of the combined
-- v11-OR-v12 pin, 2 bare occurrences of each version):
--   * the schemaVersion-6 promptVersion allowlist;
--   * the eye-colour evidence rule, which forces profile.eyeColor.evidence
--     into ('face_front','face_side','eyes_closeup') UNLESS the prompt version
--     is one of the exempt ones. That exemption is what #1157 added so a
--     selfie-only analysis could read eye colour from `early_photo`. Adding
--     v13 to the allowlist alone would re-break that fixed bug on the first
--     real consult.
-- `replace()` is global, so one call moves both. That is deliberate, not
-- incidental: the count was CHECKED, not assumed, and it must be re-checked
-- before the next pin rather than carried forward as an article of faith.
DO $patch$
DECLARE
  definition text;
  old_pin text := 'NEW."promptVersion" IS NOT DISTINCT FROM ''service-analysis-v11'' OR NEW."promptVersion" IS NOT DISTINCT FROM ''service-analysis-v12''';
  new_pin text := 'NEW."promptVersion" IS NOT DISTINCT FROM ''service-analysis-v11'' OR NEW."promptVersion" IS NOT DISTINCT FROM ''service-analysis-v12'' OR NEW."promptVersion" IS NOT DISTINCT FROM ''service-analysis-v13''';
BEGIN
  SELECT pg_get_functiondef('public.consult_analysis_payload_guard()'::regprocedure) INTO definition;
  IF position(new_pin IN definition) > 0 THEN RETURN; END IF;
  IF position(old_pin IN definition) = 0 THEN
    RAISE EXCEPTION 'Expected consultation analysis v11-or-v12 prompt pin was not found';
  END IF;
  EXECUTE replace(definition, old_pin, new_pin);
END $patch$;
