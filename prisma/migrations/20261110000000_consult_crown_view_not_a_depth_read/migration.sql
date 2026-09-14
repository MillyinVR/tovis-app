-- Prose-only prompt update: the two hair levels stop being read off the
-- OVERHEAD crown shot. The direction prompt now says what the crown view
-- actually is — a frame lit from above, brighter and more specular than the
-- same head from the side — and sends baseLevel/lightestLevel to the back and
-- side views, keeping hair_crown for density and the parting. Nothing about
-- the stored shape changes, so the schema version stays at 6 and every
-- existing row keeps its meaning. Only the version that names the words
-- moves: analysis v13 -> v14.
--
-- Measured on this engine (not inferred from the depth bench, which measured a
-- DIFFERENT reader one image at a time): 21 paired fixture-runs over
-- eval/consult/hair-color/v1. The control cited hair_crown for baseLevel in
-- 22 of 22 runs and cited it FIRST in 12 of 22 — and `shotPhrase` in
-- lib/consult/followUpContext.ts renders evidence[0] into the follow-up's
-- context block, which tells the question-writing model her depth was read
-- from "the photo looking down at the top of your hair" and licenses it to
-- refer to that photo that way when it talks to her. So over half of all
-- consults grounded the conversation layer on the one view neither reader can
-- trust for depth. With these sentences that is 1 of 23.
-- baseLevel error fell against both ground truths (0.86 -> 0.71 levels vs
-- Tori's blind grayscale root calls; 0.43 -> 0.33 vs the corpus labels) and
-- nothing regressed. Reproduce with scripts/dev/crown-level-experiment.ts.
--
-- The inspiration read is deliberately NOT bumped. It reads a reference
-- photograph the client brought, which has no shot labels and no crown view at
-- all, so these words are not in that prompt and its version must not move.
--
-- 🔴 PATCHED, never re-issued. This guard has been amended in place by several
-- earlier migrations, so rebuilding its body from the repo's files would
-- silently drop those amendments. The block reads the LIVE definition, checks
-- the expected pin is present, and replaces one substring — the same shape as
-- 20261108000000_consult_underlying_pigment,
-- 20261106000000_consult_hair_level_depth_scale and
-- 20261024000006_consult_client_language.

-- The look-plan analysis guard: allow service-analysis-v14 on schema 6.
--
-- 🔴 The pin appears TWICE in the live body and BOTH must move. RE-CHECKED on
-- 2026-09-14 rather than carried forward: production's live definition was
-- dumped with pg_get_functiondef, the two pending patches
-- (20261106000000 v11->v12 and 20261108000000 v12->v13) were replayed against
-- it read-only, and the combined v11-OR-v12-OR-v13 pin below occurs exactly 2
-- times in the result, with 0 occurrences of v14. Those two are:
--   * the schemaVersion-6 promptVersion allowlist;
--   * the eye-colour evidence rule, which forces profile.eyeColor.evidence
--     into ('face_front','face_side','eyes_closeup') UNLESS the prompt version
--     is one of the exempt ones. That exemption is what #1157 added so a
--     selfie-only analysis could read eye colour from `early_photo`. Adding
--     v14 to the allowlist alone would re-break that fixed bug on the first
--     real consult.
-- `replace()` is global, so one call moves both. The count was CHECKED, not
-- assumed, and it must be re-checked before the next pin.
--
-- 🔴 Note for whoever deploys this: as of 2026-09-14 production's guard is
-- still at the v11 pin — neither 20261106000000 nor 20261108000000 has ever
-- run against it. All three patches will apply in order in the same deploy
-- build; the chain was replayed against production's real body and each link
-- found its pin.
DO $patch$
DECLARE
  definition text;
  old_pin text := 'NEW."promptVersion" IS NOT DISTINCT FROM ''service-analysis-v11'' OR NEW."promptVersion" IS NOT DISTINCT FROM ''service-analysis-v12'' OR NEW."promptVersion" IS NOT DISTINCT FROM ''service-analysis-v13''';
  new_pin text := 'NEW."promptVersion" IS NOT DISTINCT FROM ''service-analysis-v11'' OR NEW."promptVersion" IS NOT DISTINCT FROM ''service-analysis-v12'' OR NEW."promptVersion" IS NOT DISTINCT FROM ''service-analysis-v13'' OR NEW."promptVersion" IS NOT DISTINCT FROM ''service-analysis-v14''';
BEGIN
  SELECT pg_get_functiondef('public.consult_analysis_payload_guard()'::regprocedure) INTO definition;
  IF position(new_pin IN definition) > 0 THEN RETURN; END IF;
  IF position(old_pin IN definition) = 0 THEN
    RAISE EXCEPTION 'Expected consultation analysis v11-or-v12-or-v13 prompt pin was not found';
  END IF;
  EXECUTE replace(definition, old_pin, new_pin);
END $patch$;
