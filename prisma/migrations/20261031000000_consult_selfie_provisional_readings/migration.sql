-- The early selfie has to buy her something (Tori, 2026-09-13).
--
-- A consult that reaches "Build my plan" on the early selfie alone came back
-- almost entirely UNKNOWN, because three separate rules each said "not from
-- that view". Two of them are right and stay: `surfaceOvertone` IS a colour
-- cast, and a warm room invents one; the two hair LEVELS need a hair view and
-- a selfie is not one. Two of them were too strict:
--
--   * eyeColor — an iris IS visible in a selfie, and which colour FAMILY it
--     belongs to survives ordinary indoor light far better than undertone or
--     season do. Prod, 2026-09-13 00:07Z, on Tori's own run:
--       consult analysis eye color cited a view it may not be read from;
--       read as UNKNOWN { evidence: [ 'early_photo' ] }
--     The model read it. We threw it away.
--   * skinDepth — a broad depth band, not a cast. Same argument.
--
-- Both are now kept PROVISIONALLY: the sanitizer holds the confidence range
-- below `isSupportedConsultObservation`'s 0.5 floor
-- (`CONSULT_PROVISIONAL_CONFIDENCE_MAX`), so such a reading reaches the client
-- and the pro as something real to talk about but can never quietly become
-- load-bearing evidence under a look plan. The honesty is in the number.
--
-- 🔴 THREE separate places pin this, and the TypeScript is the only one that
-- is obvious. Changing the sanitizer alone moves the failure from the
-- sanitizer to the WRITE, which is strictly worse — the paid analysis is
-- discarded either way, but with 23514 "invalid versioned service-analysis
-- payload" instead of a named check. The three:
--   1. `consult_analysis_payload_guard` pins the prompt version (needs v9).
--   2. the same guard refuses an eyeColor evidence label that is not
--      face_front / face_side / eyes_closeup.
--   3. `ConsultFaceColorProfile_prompt_version` pins the companion prompt.
-- `consult_face_color_profile_guard` already admits `early_photo` for every
-- field, so skinDepth needs no change there — checked against the live
-- definition, not assumed.
--
-- 🔴 PATCHED, NOT RETYPED. The guard's body in the migration files is stale:
-- the LIVE body has been patched in place by several later migrations that
-- each read it back with pg_get_functiondef and replaced one substring. A full
-- re-issue copied from the files silently drops all of them — that is exactly
-- how 20261029000000's first draft broke, and its header records the cost. So
-- this migration does the same thing: read the live definition, assert each
-- marker is present and unique, replace it, execute. "The rest is unchanged"
-- is then true by construction, whatever the live body is.
--
-- 🔴 EVERY EARLIER ARM IS KEPT (the migrate-before-deploy window): a
-- production deploy applies this migration INSIDE the Vercel build while the
-- previous deployment is still serving, so for the length of that build the
-- OLD code writes v8 payloads and v1 companions against the NEW guard. The v7
-- and v8 arms are not touched by one byte, and the eyeColor relaxation is
-- scoped to a v9 payload so no earlier arm changes behaviour at all.
--
-- Markers verified unique against the LIVE prod definition before writing
-- (2026-09-13), and re-asserted at run time below:
--   prompt arm marker      -> 1 occurrence
--   eyeColor evidence list -> 1 occurrence
--   'service-analysis-v9'  -> absent

-- 1) The analysis guard: the v9 prompt, and a provisional eyeColor -----------
-- Re-runnable: once v9 is in the body, this is a no-op.

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
    RAISE EXCEPTION 'selfie-provisional: consult_analysis_payload_guard() not found';
  END IF;
  IF position('service-analysis-v9' IN body) > 0 THEN
    RETURN;  -- already patched
  END IF;

  -- (a) The prompt-version arm. The marker is the tail of the schemaVersion 6
  -- arm, which names v8 and closes the arm's parentheses — no other arm has
  -- this, and v9 is simply appended beside v7 and v8.
  prompt_marker := $m$'service-analysis-v8')))$m$;
  IF position(prompt_marker IN body) = 0 THEN
    RAISE EXCEPTION 'selfie-provisional: the v8 prompt arm of consult_analysis_payload_guard() was not found where expected; refusing to patch a drifted definition';
  END IF;
  IF (length(body) - length(replace(body, prompt_marker, ''))) / length(prompt_marker) <> 1 THEN
    RAISE EXCEPTION 'selfie-provisional: the v8 prompt arm marker is not unique in consult_analysis_payload_guard()';
  END IF;

  -- (b) The eyeColor evidence list. Scoped to a v9 payload, so the v7/v8 arms
  -- keep refusing `early_photo` exactly as they do today.
  eye_marker := $m$NOT IN ('face_front', 'face_side', 'eyes_closeup')$m$;
  IF position(eye_marker IN body) = 0 THEN
    RAISE EXCEPTION 'selfie-provisional: the eyeColor evidence list of consult_analysis_payload_guard() was not found where expected; refusing to patch a drifted definition';
  END IF;
  IF (length(body) - length(replace(body, eye_marker, ''))) / length(eye_marker) <> 1 THEN
    RAISE EXCEPTION 'selfie-provisional: the eyeColor evidence marker is not unique in consult_analysis_payload_guard()';
  END IF;

  patched := replace(
    body,
    prompt_marker,
    $r$'service-analysis-v8' OR NEW."promptVersion" IS NOT DISTINCT FROM 'service-analysis-v9')))$r$
  );
  patched := replace(
    patched,
    eye_marker,
    $r$NOT IN ('face_front', 'face_side', 'eyes_closeup') AND NOT (NEW."promptVersion" IS NOT DISTINCT FROM 'service-analysis-v9' AND e.value = 'early_photo')$r$
  );

  IF patched = body THEN
    RAISE EXCEPTION 'selfie-provisional: consult_analysis_payload_guard() patch changed nothing';
  END IF;
  EXECUTE patched;
END;
$patch$;

-- 2) The face/colour companion prompt pin -----------------------------------
-- v1 is KEPT alongside v2 for the migrate-before-deploy window, exactly like
-- the arms above. Existing rows are all v1 and satisfy the new check, so the
-- ADD validates without a rewrite.

ALTER TABLE "ConsultFaceColorProfile"
  DROP CONSTRAINT IF EXISTS "ConsultFaceColorProfile_prompt_version";

ALTER TABLE "ConsultFaceColorProfile"
  ADD CONSTRAINT "ConsultFaceColorProfile_prompt_version"
  CHECK ((
    "promptVersion" = 'face-color-companion-v1'
    OR "promptVersion" = 'face-color-companion-v2'
  ) IS TRUE);
