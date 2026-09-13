-- The client answers an INTAKE question in her OWN WORDS
-- ============================================================================
--
-- Tori, 2026-09-13: "we lost the option for the client to add in there own
-- words. there were times i couldnt answer the consult questions with the
-- optios it gave me". The inspiration cards have taken free text since P5c;
-- the intake never has.
--
-- Two behaviours, both stored the same way. A NOTE alongside a chosen option,
-- and the ESCAPE HATCH — the answer code `client-words` instead of an option.
-- The words live in a `textAnswers` sidecar keyed to an answered question,
-- exactly as the inspiration contract stores them, because the answer map is a
-- vocabulary the safety policy and these guards read BY CODE, and a sentence is
-- not a code.
--
-- 🔴 Both guards below are PATCHED IN PLACE, never re-issued: their live bodies
-- carry in-place patches that no single migration file contains
-- (20261010000000, 20261023000001, 20261031000000, 20261101000000 …). Each
-- patch asserts its marker first and returns early when already applied.

-- ── 0. One rule for what a typed answer IS ──────────────────────────────────
--
-- The intake sidecar and the follow-up round's own column are checked by the
-- SAME function, mirroring lib/consult/clientText.ts. Three copies of "600
-- characters, trimmed, no control codes" is three places for the database to
-- disagree with the application about a sentence a real person typed.
CREATE OR REPLACE FUNCTION public.consult_client_text_map_valid(value jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_typeof(value) = 'object' AND NOT EXISTS (
    SELECT 1 FROM jsonb_each(value) AS note
    WHERE jsonb_typeof(note.value) <> 'string'
      OR btrim(note.value #>> '{}') <> note.value #>> '{}'
      OR length(note.value #>> '{}') NOT BETWEEN 1 AND 600
      OR note.value #>> '{}' ~ E'[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]'
  )
$$;
ALTER FUNCTION public.consult_client_text_map_valid(jsonb) SET search_path = '';

-- ── 1. consult_intake_payload_guard ─────────────────────────────────────────
--
-- Learns the sidecar and the sentinel. The per-pack answer rules are reached
-- through `answers_coded` — the answers with every typed one removed — so an
-- answer she gave in words skips the option-value check it could never pass,
-- while `answers` itself still drives the unknown-key and completeness checks:
-- a question answered in words IS answered.
DO $patch$
DECLARE definition text;
  declare_marker text := '  goal_direction_required BOOLEAN;';
  assign_marker text := '  answers := NEW."payload" -> ''answers'';';
  upkeep_marker text := '    answers := answers - ''maintenance_tolerance'';';
  keys_marker text := '    OR NEW."payload" - ARRAY[
      ''packId'', ''packVersion'', ''schemaVersion'', ''complete'', ''answers''
    ] <> ''{}''::jsonb';
BEGIN
  SELECT pg_get_functiondef('public.consult_intake_payload_guard()'::regprocedure) INTO definition;
  IF position('answers_coded' IN definition) > 0 THEN RETURN; END IF;
  IF position(declare_marker IN definition) = 0
    OR position(assign_marker IN definition) = 0
    OR position(upkeep_marker IN definition) = 0
    OR position(keys_marker IN definition) = 0
  THEN
    RAISE EXCEPTION 'Expected consult_intake_payload_guard markers were not found';
  END IF;

  -- Option-value checks read the CODED answers. Every one of them is written
  -- `(answers ? 'key' AND answers ->> 'key' NOT IN (...))`, and the two
  -- treatment sweeps iterate `jsonb_each(answers) AS treatment`; nothing else
  -- in this function matches these shapes. The unknown-key checks
  -- (`answers - ARRAY[...]`), the completeness checks (`answers ?& ARRAY[...]`),
  -- the string-type sweep (`AS answer`) and the goal-direction predicates keep
  -- reading the FULL map on purpose.
  definition := replace(definition, '(answers ? ''', '(answers_coded ? ''');
  definition := replace(definition, 'AND answers ->> ''', 'AND answers_coded ->> ''');
  definition := replace(definition, 'jsonb_each(answers) AS treatment', 'jsonb_each(answers_coded) AS treatment');

  definition := replace(definition, declare_marker,
    declare_marker || E'\n  text_answers JSONB;\n  answers_coded JSONB;');

  definition := replace(definition, keys_marker, $keys$    OR NEW."payload" - ARRAY[
      'packId', 'packVersion', 'schemaVersion', 'complete', 'answers',
      'textAnswers'
    ] <> '{}'::jsonb$keys$);

  definition := replace(definition, assign_marker, assign_marker || E'\n' || $body$
  -- ── Her own words ────────────────────────────────────────────────────────
  text_answers := COALESCE(NEW."payload" -> 'textAnswers', '{}'::jsonb);

  -- Only the CURRENT version of each pack takes free text. An archived version
  -- carrying words was not written by this contract — and because the sentinel
  -- below is admitted only when its words are present, an archived version can
  -- never carry the `client-words` answer code either.
  IF jsonb_typeof(text_answers) IS DISTINCT FROM 'object'
    OR (NEW."payload" ? 'textAnswers' AND (
      text_answers = '{}'::jsonb
      OR NOT (
        (pack_id = 'hair-color' AND pack_version = '4'::jsonb)
        OR (pack_id = 'hair-general' AND pack_version = '3'::jsonb)
        OR (pack_id = 'general-service' AND pack_version = '2'::jsonb)
      )
    ))
    -- Shaped like any client text this app stores, and keyed to a question she
    -- actually ANSWERED — a note on an unanswered question is an orphan no
    -- reader would ever show.
    OR NOT public.consult_client_text_map_valid(text_answers)
    OR EXISTS (
      SELECT 1 FROM jsonb_object_keys(text_answers) AS note(key)
      WHERE NOT (answers ? note.key)
    )
    -- The pairing. `client-words` is an answer only when the words are there;
    -- on its own it means nothing to the client, the professional or the
    -- safety policy.
    OR EXISTS (
      SELECT 1 FROM jsonb_each_text(answers) AS answer
      WHERE answer.value = 'client-words' AND NOT (text_answers ? answer.key)
    )
  THEN
    RAISE EXCEPTION 'invalid consult intake client words'
      USING ERRCODE = '23514';
  END IF;

  answers_coded := answers - ARRAY(
    SELECT typed.key FROM jsonb_each_text(answers) AS typed
    WHERE typed.value = 'client-words'
  )::text[];
$body$);

  -- The upkeep remap strips one key from `answers`; the coded copy follows it.
  definition := replace(definition, upkeep_marker,
    upkeep_marker || E'\n    answers_coded := answers_coded - ''maintenance_tolerance'';');

  EXECUTE definition;
END $patch$;

-- ── 2. consult_analysis_payload_guard ───────────────────────────────────────
--
-- Three changes, and the first two are only here because the third needs a new
-- prompt version to ride on:
--
--   * the v11 prompt is admitted alongside v7–v10 on schema 6;
--   * the `early_photo` eyeColor evidence exception, scoped to v9/v10 by
--     20261031000000, is carried forward to v11 — without this line a v11
--     analysis that reads eye colour from the early selfie is refused 23514,
--     which is the regression this guard has already had once;
--   * REQUIRED and SUPPORTED safety codes stop being one array. A safety
--     question she answered in her own words reads as 'not-sure' (so its
--     unknown code is REQUIRED — her words may never CLEAR a safety question),
--     and that question's own positive code becomes SUPPORTED, so the model MAY
--     raise it if her sentence actually reports the concern. Mirrors
--     lib/consult/safetyFlags.ts exactly: `reading()` and `CLIENT_WORDS_MAY_RAISE`.
DO $patch$
DECLARE definition text;
  prompt_marker text := 'NEW."promptVersion" IS NOT DISTINCT FROM ''service-analysis-v10'')))';
  eye_marker text := 'NEW."promptVersion" IS NOT DISTINCT FROM ''service-analysis-v10'') AND e.value = ''early_photo''';
  intake_marker text := '  intake_pack := intake_payload ->> ''packId'';';
  compromise_marker text := '  IF NEW."payload" #>> ''{core,visibleCondition,value}'' = ''POSSIBLE_COMPROMISE'' THEN
    required_codes := array_append(required_codes, ''VISIBLE_COMPROMISE'');
  END IF;';
  present_marker text := 'WHERE NOT (flag_item ->> ''code'' = ANY (required_codes))';
BEGIN
  SELECT pg_get_functiondef('public.consult_analysis_payload_guard()'::regprocedure) INTO definition;
  IF position('supported_codes' IN definition) > 0 THEN RETURN; END IF;
  IF position(prompt_marker IN definition) = 0
    OR position(eye_marker IN definition) = 0
    OR position(intake_marker IN definition) = 0
    OR position(compromise_marker IN definition) = 0
    OR position(present_marker IN definition) = 0
  THEN
    RAISE EXCEPTION 'Expected consult_analysis_payload_guard markers were not found';
  END IF;

  definition := replace(definition, prompt_marker,
    'NEW."promptVersion" IS NOT DISTINCT FROM ''service-analysis-v10'' OR NEW."promptVersion" IS NOT DISTINCT FROM ''service-analysis-v11'')))');
  definition := replace(definition, eye_marker,
    'NEW."promptVersion" IS NOT DISTINCT FROM ''service-analysis-v10'' OR NEW."promptVersion" IS NOT DISTINCT FROM ''service-analysis-v11'') AND e.value = ''early_photo''');

  definition := replace(definition, '  recommendation JSONB;',
    E'  recommendation JSONB;\n  intake_text JSONB;\n  supported_codes TEXT[];');

  definition := replace(definition, intake_marker, intake_marker || E'\n' || $body$
  -- A safety question answered in her OWN WORDS is unknown to every rule
  -- below: they read codes, and a sentence is not a code. It reads 'not-sure',
  -- exactly as lib/consult/safetyFlags.ts `reading()` does, whatever option
  -- code sits beside the words — a note next to "no" does not make it a
  -- clean no.
  intake_text := COALESCE(intake_payload -> 'textAnswers', '{}'::jsonb);
  intake_answers := intake_answers || COALESCE((
    SELECT jsonb_object_agg(typed.key, to_jsonb('not-sure'::text))
    FROM jsonb_object_keys(intake_text) AS typed(key)
    WHERE typed.key IN (
      'prior_reaction', 'box_dye_history', 'prior_lightening',
      'chemical_history', 'recent_treatment_timing', 'known_allergies',
      'skin_sensitivity'
    )
  ), '{}'::jsonb);
$body$);

  definition := replace(definition, compromise_marker, compromise_marker || E'\n' || $body$
  -- What her words may turn out to MEAN: allowed to the model, never demanded
  -- of it. Exactly the codes each question's positive ANSWERS raise, so the
  -- model can reach no conclusion the option list could not.
  supported_codes := required_codes;
  IF intake_text ? 'prior_reaction' THEN supported_codes := array_append(supported_codes, 'PRIOR_REACTION'); END IF;
  IF intake_text ? 'box_dye_history' THEN supported_codes := array_append(supported_codes, 'RECENT_BOX_DYE'); END IF;
  IF intake_text ? 'prior_lightening' THEN supported_codes := array_append(supported_codes, 'RECENT_LIGHTENING'); END IF;
  IF intake_text ? 'chemical_history' THEN supported_codes := array_append(supported_codes, 'RECENT_CHEMICAL_SERVICE'); END IF;
  IF intake_text ? 'recent_treatment_timing' THEN supported_codes := array_append(supported_codes, 'RECENT_CHEMICAL_SERVICE'); END IF;
  IF intake_text ? 'known_allergies' THEN supported_codes := array_append(supported_codes, 'KNOWN_ALLERGY'); END IF;
  IF intake_text ? 'skin_sensitivity' THEN supported_codes := array_append(supported_codes, 'SENSITIVITY_REPORTED'); END IF;
$body$);

  definition := replace(definition, present_marker,
    'WHERE NOT (flag_item ->> ''code'' = ANY (supported_codes))');

  EXECUTE definition;
END $patch$;

-- ── 3. Her own words on a THREAD FOLLOW-UP card ─────────────────────────────
--
-- 🔴 Their OWN column, and this is the whole reason for it.
-- `ConsultFollowUpRound.answers` carries `ConsultFollowUpRound_no_identity_words`,
-- which refuses the words face / eye / skin / undertone / identity / ethnic /
-- race / health ANYWHERE in that column. That constraint exists to stop the
-- MODEL writing identity inferences into a durable row, and it should keep
-- doing exactly that — but the CLIENT now types here too, and "I had a reaction
-- on my skin" is an ordinary sentence about herself that would be refused
-- 23514 after she had already written it.
--
-- Tori's call, 2026-09-13: give her words their own place. The ban stays on
-- everything the model writes; what she says about herself is not policed for
-- saying "skin".
ALTER TABLE "ConsultFollowUpRound"
  ADD COLUMN IF NOT EXISTS "clientTextAnswers" JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE "ConsultFollowUpRound"
  DROP CONSTRAINT IF EXISTS "ConsultFollowUpRound_client_text_shape";
ALTER TABLE "ConsultFollowUpRound"
  ADD CONSTRAINT "ConsultFollowUpRound_client_text_shape"
  CHECK (public.consult_client_text_map_valid("clientTextAnswers"));

-- Not an identity ban — a secrets ban, the same one `answers` carries. A
-- provider dump or a storage pointer is not something a client types, so this
-- one costs her nothing.
ALTER TABLE "ConsultFollowUpRound"
  DROP CONSTRAINT IF EXISTS "ConsultFollowUpRound_client_text_no_secret_keys";
ALTER TABLE "ConsultFollowUpRound"
  ADD CONSTRAINT "ConsultFollowUpRound_client_text_no_secret_keys"
  CHECK (
    ("clientTextAnswers")::text !~* '"(base64|bytes|signedUrl|token|storagePath|storageBucket|providerRequest|providerResponse|hiddenReasoning)"[[:space:]]*:'
  );

-- The round total stays bounded the way `answers` is.
ALTER TABLE "ConsultFollowUpRound"
  DROP CONSTRAINT IF EXISTS "ConsultFollowUpRound_client_text_length";
ALTER TABLE "ConsultFollowUpRound"
  ADD CONSTRAINT "ConsultFollowUpRound_client_text_length"
  CHECK (length(("clientTextAnswers")::text) <= 4000);

-- ── 4. consult_follow_up_round_guard ────────────────────────────────────────
--
-- The stored question shape is closed by subtraction, so `allowText` is refused
-- until this guard learns it — found by the integration suite, not by reading
-- the TypeScript.
--
-- 🔴 OPTIONAL, never required. This trigger is BEFORE INSERT **OR UPDATE**, and
-- filing an answer UPDATEs the row: making the field mandatory would refuse the
-- next answer on every round created by the deployment before this one, for the
-- whole life of those consults.
DO $patch$
DECLARE definition text;
  keys_marker text := '      OR NOT question.value ?& ARRAY[''key'',''text'',''home'',''evidence'',''options'']
      OR question.value - ARRAY[''key'',''text'',''home'',''evidence'',''options''] <> ''{}''::jsonb';
  home_marker text := '  -- A FALLBACK round is the pack''s own safety questions, which no model wrote.';
BEGIN
  SELECT pg_get_functiondef('public.consult_follow_up_round_guard()'::regprocedure) INTO definition;
  IF position('allowText' IN definition) > 0 THEN RETURN; END IF;
  IF position(keys_marker IN definition) = 0 OR position(home_marker IN definition) = 0 THEN
    RAISE EXCEPTION 'Expected consult_follow_up_round_guard markers were not found';
  END IF;

  definition := replace(definition, keys_marker, $keys$      OR NOT question.value ?& ARRAY['key','text','home','evidence','options']
      -- `allowText` is admitted but NOT demanded: a round written before free
      -- text existed must still accept its next answer, and this trigger runs
      -- on UPDATE.
      OR question.value - ARRAY['key','text','home','evidence','options','allowText'] <> '{}'::jsonb
      OR (question.value ? 'allowText'
        AND jsonb_typeof(question.value -> 'allowText') IS DISTINCT FROM 'boolean')$keys$);

  definition := replace(definition, home_marker, $body$  -- ── Her own words ───────────────────────────────────────────────────────
  --
  -- Their own COLUMN, because `answers` carries a CHECK refusing the words
  -- face / eye / skin / undertone / identity / ethnic / race / health anywhere
  -- in it — right for what the MODEL writes, and fatal for "I had a reaction on
  -- my skin" once the client types here too. The shape is checked by
  -- `ConsultFollowUpRound_client_text_shape`; what is checked HERE is the only
  -- thing that needs the round's own questions: that a note belongs to a
  -- question this round asked and that takes words, and that the client-words
  -- answer code never stands without the words it points at.
  IF EXISTS (
    SELECT 1
    FROM jsonb_object_keys(NEW."clientTextAnswers") AS noted(key)
    WHERE NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(NEW."questions") AS question(value)
      WHERE question.value ->> 'key' = noted.key
        AND question.value -> 'allowText' = 'true'::jsonb
    )
  ) THEN
    RAISE EXCEPTION 'consult follow-up client words belong to no question here'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_each(NEW."answers") AS answer(key, value)
    WHERE value @> '["client-words"]'::jsonb
      AND NOT (NEW."clientTextAnswers" ? answer.key)
  ) THEN
    RAISE EXCEPTION 'consult follow-up client words are missing'
      USING ERRCODE = '23514';
  END IF;

  -- A FALLBACK round is the pack's own safety questions, which no model wrote.$body$);

  EXECUTE definition;
END $patch$;
