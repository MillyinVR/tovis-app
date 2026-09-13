-- Photos must never block booking (Tori, 2026-09-13).
--
--   "people scroll at times they can't necessarily get a perfect quality
--    image … we absolutely can not make the pictures be a blocker"
--
-- A look plan carried ONE field that answered two different questions. Is this
-- reading THIN (a warm-lit selfie says yes) and MAY she book it were both
-- `provisional`, derived from `status`, which `startingPointSufficient` — a
-- photo check — helped decide. So the photograph quietly withdrew the booking.
--
-- The plan now carries `choosable` as its own field. `provisional` keeps its
-- exact meaning and its exact derivation (the pin below is untouched), because
-- three other things read it: the "Draft" label, the daylight caveat, and the
-- provisional-INTAKE allowance in `consult_revision_requires_agreements`.
--
-- Three changes here, and all three are DATABASE pins that would otherwise
-- turn this feature into a 23514 write refusal after the analysis was paid
-- for — the failure mode 20261031000000's header records. They were found by
-- sweeping pg_constraint and pg_proc against the LIVE database before any code
-- was written, not by reading the TypeScript:
--
--   1. `consult_look_plan_snapshot_valid` refuses a PRO_REVIEW plan that
--      carries paths, and pins the plan's exact key set (so an unknown
--      `choosable` key is itself a refusal).
--   2. `consult_look_brief_version_guard` refuses a selected path unless the
--      plan's status is literally READY_TO_CHOOSE — the database twin of the
--      TypeScript gate in lib/consult/lookBrief.ts. Relaxing one without the
--      other moves the failure from a named refusal to a raw 23514.
--   3. `consult_analysis_payload_guard` pins the prompt version by exact
--      string, so v10 cannot be written until it is taught.
--
-- 🔴 PATCHED, NOT RETYPED — every function here. `consult_look_brief_version_guard`
-- has been patched in place twice already (20261023000008, 20261023000009) and
-- `consult_analysis_payload_guard` several times more; their bodies in the
-- migration files are stale, and a re-issue copied from those files silently
-- drops every later patch. Each block below reads the LIVE definition, asserts
-- its marker is present and UNIQUE, replaces that substring, and executes. "The
-- rest is unchanged" is then true by construction, whatever the live body is.
--
-- 🔴 EVERY EARLIER ARM IS KEPT (the migrate-before-deploy window): a production
-- deploy applies this migration INSIDE the Vercel build while the previous
-- deployment is still serving. For the length of that build the OLD code writes
-- v9 payloads and plans with NO `choosable` key against the NEW guard, so
-- `choosable` is OPTIONAL everywhere and a plan without it is read as the
-- permission the old gates actually applied: `status = 'READY_TO_CHOOSE'`.
-- Every block is re-runnable and a no-op once applied.

-- 1) The look-plan snapshot: an optional `choosable`, and paths under PRO_REVIEW

DO $patch$
DECLARE
  body TEXT;
  keys_marker TEXT;
  paths_marker TEXT;
  patched TEXT;
BEGIN
  SELECT pg_get_functiondef('public.consult_look_plan_snapshot_valid(jsonb,jsonb,text,text)'::regprocedure)
    INTO body;
  IF body IS NULL THEN
    RAISE EXCEPTION 'photos-never-block: consult_look_plan_snapshot_valid() not found';
  END IF;
  IF position('choosable' IN body) > 0 THEN
    RETURN;  -- already patched
  END IF;

  -- (a) The exact-key set. `choosable` and `safetyRouted` join the SUBTRACTION
  -- (no unknown keys) but deliberately NOT the `?&` required-key list above it:
  -- a plan written before today carries neither and must still validate.
  --
  -- `safetyRouted` says a patch or strand test is required. It does NOT gate
  -- anything here — Tori's call is that the pro's booking review is the
  -- review — but the booking reads it to tell her a test comes first, and for
  -- a look-planning consult it is the ONLY place that fact exists:
  -- `resolveRecommendations` collapses such an analysis to one CONSULTATION.
  keys_marker := $m$plan - ARRAY['schemaVersion','tier','status','provisional','summary','nextStep','paths'] <> '{}'::jsonb$m$;
  IF position(keys_marker IN body) = 0 THEN
    RAISE EXCEPTION 'photos-never-block: the key set of consult_look_plan_snapshot_valid() was not found where expected; refusing to patch a drifted definition';
  END IF;
  IF (length(body) - length(replace(body, keys_marker, ''))) / length(keys_marker) <> 1 THEN
    RAISE EXCEPTION 'photos-never-block: the key-set marker is not unique in consult_look_plan_snapshot_valid()';
  END IF;

  -- (b) PRO_REVIEW keeps its paths. The pro reviewing feasibility is a reason
  -- to SHOW her the look and say so, never a reason to delete it. NO_OFFERING
  -- still carries none, because there is genuinely nothing on the menu to host.
  paths_marker := $m$OR (plan->>'status' IN ('PRO_REVIEW','NO_OFFERING') AND jsonb_array_length(plan->'paths') <> 0)$m$;
  IF position(paths_marker IN body) = 0 THEN
    RAISE EXCEPTION 'photos-never-block: the status/paths rule of consult_look_plan_snapshot_valid() was not found where expected; refusing to patch a drifted definition';
  END IF;
  IF (length(body) - length(replace(body, paths_marker, ''))) / length(paths_marker) <> 1 THEN
    RAISE EXCEPTION 'photos-never-block: the status/paths marker is not unique in consult_look_plan_snapshot_valid()';
  END IF;

  patched := replace(body, keys_marker,
    $r$plan - ARRAY['schemaVersion','tier','status','provisional','summary','nextStep','paths','choosable','safetyRouted'] <> '{}'::jsonb
    OR (plan ? 'safetyRouted' AND jsonb_typeof(plan->'safetyRouted') IS DISTINCT FROM 'boolean')$r$);

  -- Permission must be a boolean, and she may choose only something that
  -- EXISTS (a path), on a menu that can host it, and that no one is waiting to
  -- review. Byte-for-byte the invariant `normalizeStoredConsultLookPlan`
  -- enforces, so nothing can be written here that cannot be read back. An
  -- absent `choosable` reads as the old gate.
  patched := replace(patched, paths_marker,
    $r$OR (plan->>'status' = 'NO_OFFERING' AND jsonb_array_length(plan->'paths') <> 0)
    OR (plan ? 'choosable' AND jsonb_typeof(plan->'choosable') IS DISTINCT FROM 'boolean')
    OR (COALESCE(plan->'choosable', to_jsonb(plan->>'status' = 'READY_TO_CHOOSE')) = 'true'::jsonb
        AND (jsonb_array_length(plan->'paths') = 0
             OR plan->>'status' IN ('NO_OFFERING','PRO_REVIEW')))$r$);

  IF patched = body THEN
    RAISE EXCEPTION 'photos-never-block: consult_look_plan_snapshot_valid() patch changed nothing';
  END IF;
  EXECUTE patched;
END;
$patch$;

-- 2) The brief guard: choosing a path asks `choosable`, not the status string

DO $patch$
DECLARE
  body TEXT;
  marker TEXT;
  patched TEXT;
BEGIN
  SELECT pg_get_functiondef('public.consult_look_brief_version_guard()'::regprocedure)
    INTO body;
  IF body IS NULL THEN
    RAISE EXCEPTION 'photos-never-block: consult_look_brief_version_guard() not found';
  END IF;
  IF position('lookPlan,choosable' IN body) > 0 THEN
    RETURN;  -- already patched
  END IF;

  -- Scoped to the SOURCE payload's plan. The professional-plan arm above it
  -- tests `NEW."professionalPlan"->>'status'` and is deliberately untouched: a
  -- pro authoring a plan by hand still commits to READY_TO_CHOOSE.
  marker := $m$(source_payload #>> '{lookPlan,status}' <> 'READY_TO_CHOOSE'$m$;
  IF position(marker IN body) = 0 THEN
    RAISE EXCEPTION 'photos-never-block: the selected-path rule of consult_look_brief_version_guard() was not found where expected; refusing to patch a drifted definition';
  END IF;
  IF (length(body) - length(replace(body, marker, ''))) / length(marker) <> 1 THEN
    RAISE EXCEPTION 'photos-never-block: the selected-path marker is not unique in consult_look_brief_version_guard()';
  END IF;

  patched := replace(body, marker,
    $r$(COALESCE(source_payload #> '{lookPlan,choosable}', to_jsonb(source_payload #>> '{lookPlan,status}' = 'READY_TO_CHOOSE')) IS DISTINCT FROM 'true'::jsonb$r$);

  IF patched = body THEN
    RAISE EXCEPTION 'photos-never-block: consult_look_brief_version_guard() patch changed nothing';
  END IF;
  EXECUTE patched;
END;
$patch$;

-- 3) The analysis guard: the v10 prompt
--
-- v10 gives the PROFILE call the positive selfie clause the face-colour
-- companion already had. Prompt-only: geometry has no per-field view rule in
-- the sanitizer (only eyeColor does), none in this guard (only eyeColor and
-- the two hair levels), and `consult_analysis_evidence_valid` has always
-- accepted `early_photo` — each checked against the live definitions here
-- before the change, not inferred. The eyeColor relaxation v9 introduced is
-- extended to v10, because v10 still reads an iris from the selfie.

DO $patch$
DECLARE
  body TEXT;
  prompt_marker TEXT;
  eye_marker TEXT;
  patched TEXT;
BEGIN
  SELECT pg_get_functiondef('public.consult_analysis_payload_guard()'::regprocedure)
    INTO body;
  IF body IS NULL THEN
    RAISE EXCEPTION 'photos-never-block: consult_analysis_payload_guard() not found';
  END IF;
  IF position('service-analysis-v10' IN body) > 0 THEN
    RETURN;  -- already patched
  END IF;

  -- (a) The eyeColor arm FIRST: its marker names v9, and patching the prompt
  -- arm first would leave two places mentioning v9 to disambiguate.
  eye_marker := $m$AND NOT (NEW."promptVersion" IS NOT DISTINCT FROM 'service-analysis-v9' AND e.value = 'early_photo')$m$;
  IF position(eye_marker IN body) = 0 THEN
    RAISE EXCEPTION 'photos-never-block: the v9 eyeColor arm of consult_analysis_payload_guard() was not found where expected; refusing to patch a drifted definition';
  END IF;
  IF (length(body) - length(replace(body, eye_marker, ''))) / length(eye_marker) <> 1 THEN
    RAISE EXCEPTION 'photos-never-block: the v9 eyeColor marker is not unique in consult_analysis_payload_guard()';
  END IF;

  -- (b) The prompt-version arm — the tail of the schemaVersion 6 arm, which
  -- now ends at v9. v7, v8 and v9 are not touched by one byte.
  prompt_marker := $m$'service-analysis-v9')))$m$;
  IF position(prompt_marker IN body) = 0 THEN
    RAISE EXCEPTION 'photos-never-block: the v9 prompt arm of consult_analysis_payload_guard() was not found where expected; refusing to patch a drifted definition';
  END IF;
  IF (length(body) - length(replace(body, prompt_marker, ''))) / length(prompt_marker) <> 1 THEN
    RAISE EXCEPTION 'photos-never-block: the v9 prompt arm marker is not unique in consult_analysis_payload_guard()';
  END IF;

  patched := replace(body, eye_marker,
    $r$AND NOT ((NEW."promptVersion" IS NOT DISTINCT FROM 'service-analysis-v9' OR NEW."promptVersion" IS NOT DISTINCT FROM 'service-analysis-v10') AND e.value = 'early_photo')$r$);
  patched := replace(patched, prompt_marker,
    $r$'service-analysis-v9' OR NEW."promptVersion" IS NOT DISTINCT FROM 'service-analysis-v10')))$r$);

  IF patched = body THEN
    RAISE EXCEPTION 'photos-never-block: consult_analysis_payload_guard() patch changed nothing';
  END IF;
  EXECUTE patched;
END;
$patch$;
