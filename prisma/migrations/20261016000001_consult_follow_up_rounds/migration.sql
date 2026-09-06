-- P5g, slice 2 of 2 — the adaptive follow-up round, and one widened cap.
--
-- Two independent changes, both strictly EXPAND-ONLY, so this migration is safe
-- in the window between merge and deploy (P4c: migrations apply in the deploy
-- build, but the guard functions are shared with whatever is currently live):
--
--   1. A NEW TABLE. Nothing deployed writes it, so it cannot break anything.
--   2. `consult_inspiration_payload_guard` admits up to SIXTEEN values in one
--      answer array where it admitted eight. Every payload that validated
--      before still validates; the function is otherwise byte-identical to the
--      one 20261012000000 installed.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- 1. The follow-up round
-- ─────────────────────────────────────────────────────────────────────────────
-- WHY A TABLE AND NOT A ConsultRevision.
--
-- Every other consult artefact is a revision, and this one deliberately is not.
-- A revision payload is keys and enums — the payload guards refuse prose by
-- construction, which is the property that makes them worth having. A follow-up
-- round is the one artefact whose whole point is a SENTENCE the model wrote
-- ("You're at a light brown now and you loved the ash — that's usually two
-- visits; would coming back in a few weeks work?"). Putting prose through
-- `consult_revision_requires_agreements` would mean widening a guard that
-- protects five other kinds, to admit the one thing they exist to exclude.
--
-- So the prose lives here, behind its OWN constraints, and the revision guards
-- are untouched.
--
-- WHAT IS AND IS NOT STORED HERE.
--
--   * `questions` — the model's questions, as prose plus the enum options each
--     one maps to. Fenced by the identity-word regex and the secret-key regex
--     word-for-word from the revision guards, plus hard length caps.
--   * `answers` — ONLY the answers whose vocabulary has no other home: the
--     post-booking follow-up pack (lib/consult/intake/followUp.ts), which until
--     now defined its questions and had nowhere to put the replies. Keys and
--     enums, exactly as a revision payload would hold them.
--
--   🔴 An answer to a question keyed in the INTAKE pack is NOT stored here. It
--   is written to the intake revision, because that is what the safety policy
--   (lib/consult/safetyFlags.ts) and `consult_analysis_payload_guard` read. A
--   henna answer collected as a follow-up and stored in this table would be a
--   henna answer the analysis cannot see — which is the exact class of bug
--   "one home per vocabulary" exists to prevent. Likewise a prep/inspiration
--   home is this table.
--
-- WHY THE UNIQUE INDEX IS THE CAP.
--
-- "At most three rounds per plan version" and "one call per answer burst" are
-- the same constraint seen twice, and `(consultSessionId, planVersion, round)`
-- is both of them as a database fact. A double-tapped answer, a retried POST
-- and two concurrent requests all lose the insert rather than each buying a
-- paid call. A counter in application code would be a race with money in it.

CREATE TABLE "ConsultFollowUpRound" (
  "id" TEXT NOT NULL,
  "consultSessionId" TEXT NOT NULL,

  -- Which plan the round belongs to. The cap is PER VERSION: a client who
  -- reworks her plan gets a fresh three questions about the new one, which is
  -- the point of a living document. Plan versions are themselves capped at
  -- four (CONSULT_MAX_PLAN_VERSIONS), so the ceiling is 12 calls per consult.
  "planVersion" INTEGER NOT NULL,
  "round" INTEGER NOT NULL,

  "status" "ConsultFollowUpRoundStatus" NOT NULL,

  "schemaVersion" INTEGER NOT NULL,
  "promptVersion" TEXT NOT NULL,
  -- NULL on a FALLBACK round: no model answered it, and recording one that did
  -- not run would put a model's name on questions it never wrote.
  "model" TEXT,

  "questions" JSONB NOT NULL,
  "answers" JSONB NOT NULL DEFAULT '{}'::jsonb,

  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "answeredAt" TIMESTAMP(3),

  CONSTRAINT "ConsultFollowUpRound_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "ConsultFollowUpRound"
  ADD CONSTRAINT "ConsultFollowUpRound_consultSessionId_fkey"
  FOREIGN KEY ("consultSessionId") REFERENCES "ConsultSession"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- The cap, and the anti-double-bill. See the note above.
CREATE UNIQUE INDEX "ConsultFollowUpRound_session_version_round_key"
  ON "ConsultFollowUpRound" ("consultSessionId", "planVersion", "round");

CREATE INDEX "ConsultFollowUpRound_consultSessionId_createdAt_idx"
  ON "ConsultFollowUpRound" ("consultSessionId", "createdAt");

-- ── The CHECKs ──────────────────────────────────────────────────────────────
-- What a CHECK can hold is held in a CHECK; the per-element shape needs a
-- set-returning function, which CHECK constraints may not call, so it is a
-- trigger below. Both run on every write.

ALTER TABLE "ConsultFollowUpRound"
  ADD CONSTRAINT "ConsultFollowUpRound_round_range"
  CHECK ("round" BETWEEN 1 AND 3),
  ADD CONSTRAINT "ConsultFollowUpRound_plan_version_range"
  CHECK ("planVersion" BETWEEN 1 AND 4),
  ADD CONSTRAINT "ConsultFollowUpRound_schema_version"
  CHECK ("schemaVersion" = 1),
  ADD CONSTRAINT "ConsultFollowUpRound_prompt_version_shape"
  CHECK ("promptVersion" ~ '^[a-z][a-z0-9-]{0,63}$'),
  -- A round asks between one and three questions. Zero is not a round, and the
  -- ceiling is the brief's.
  ADD CONSTRAINT "ConsultFollowUpRound_questions_shape"
  CHECK (
    jsonb_typeof("questions") = 'array'
    AND jsonb_array_length("questions") BETWEEN 1 AND 3
  ),
  ADD CONSTRAINT "ConsultFollowUpRound_answers_shape"
  CHECK (jsonb_typeof("answers") = 'object'),
  -- 🔴 The content regex, word-for-word from `consult_inspiration_payload_guard`
  -- and `consult_intake_payload_guard`. The model writes this text, so it is
  -- the one artefact in the consult where the rule has teeth against a
  -- non-human author: a question may describe HAIR and a service, never the
  -- person. `\m…\M` are POSIX word boundaries and a hyphen is one of them.
  ADD CONSTRAINT "ConsultFollowUpRound_no_identity_words"
  CHECK (
    "questions"::text !~* '\m(face|eyes?|skin|undertone|identity|ethnic|ethnicity|race|health)\M'
    AND "answers"::text !~* '\m(face|eyes?|skin|undertone|identity|ethnic|ethnicity|race|health)\M'
  ),
  -- Nothing that carries a secret or a raw image, same list as the revision
  -- guards. A model cannot produce these, but a future caller could.
  ADD CONSTRAINT "ConsultFollowUpRound_no_secret_keys"
  CHECK (
    "questions"::text !~* '"(base64|bytes|signedUrl|token|storagePath|storageBucket|providerRequest|providerResponse|hiddenReasoning)"[[:space:]]*:'
    AND "answers"::text !~* '"(base64|bytes|signedUrl|token|storagePath|storageBucket|providerRequest|providerResponse|hiddenReasoning)"[[:space:]]*:'
  ),
  -- Length caps. Three questions of at most ~300 characters with a handful of
  -- short options cannot reach 6 kB; the cap is what stops a round becoming an
  -- unbounded document, and it is checked on the serialized whole so no amount
  -- of nesting can get around it.
  ADD CONSTRAINT "ConsultFollowUpRound_questions_length"
  CHECK (length("questions"::text) <= 6000),
  ADD CONSTRAINT "ConsultFollowUpRound_answers_length"
  CHECK (length("answers"::text) <= 2000),
  -- 🔴 `answeredAt` is TELEMETRY, not the completion signal, and the two must
  -- not be confused. Whether a round is finished is DERIVED at read time from
  -- each question's own home — an INTAKE-home question is answered when the
  -- intake revision holds its key, and this table never sees that answer at
  -- all. A round of three intake questions would therefore have an empty
  -- `answers` forever, so tying the two together (the obvious constraint, and
  -- the one this was first written as) would have made every such round
  -- unfinishable. All this may say is that a stamp is not older than the row.
  ADD CONSTRAINT "ConsultFollowUpRound_answered_at_not_before_created"
  CHECK ("answeredAt" IS NULL OR "answeredAt" >= "createdAt");

-- ── The per-element shape ───────────────────────────────────────────────────
-- Everything a CHECK cannot express: the shape of each question object and of
-- each answer entry. Deliberately mirrors the vocabulary rules the revision
-- guards apply, so a key or a value that is legal here is legal in the home it
-- will eventually be written to.
CREATE OR REPLACE FUNCTION public.consult_follow_up_round_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
BEGIN
  -- One question: a slug-shaped key, prose within the cap, a home this repo
  -- knows, an evidence line, and one to six token-shaped options each with a
  -- label. `additionalProperties` is closed by subtraction, the same way every
  -- payload guard closes one.
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(NEW."questions") AS question(value)
    WHERE jsonb_typeof(question.value) IS DISTINCT FROM 'object'
      OR NOT question.value ?& ARRAY['key','text','home','evidence','options']
      OR question.value - ARRAY['key','text','home','evidence','options'] <> '{}'::jsonb
      OR jsonb_typeof(question.value -> 'key') IS DISTINCT FROM 'string'
      OR question.value ->> 'key' !~ '^[a-z][a-z0-9_]{0,63}$'
      OR jsonb_typeof(question.value -> 'text') IS DISTINCT FROM 'string'
      OR length(question.value ->> 'text') NOT BETWEEN 1 AND 300
      -- TWO homes, because two vocabularies can be asked as a text question:
      -- the live INTAKE pack (which is where a safety answer must land, so the
      -- policy and `consult_analysis_payload_guard` can read it) and the
      -- post-booking FOLLOW_UP pack (lib/consult/intake/followUp.ts), whose
      -- home is this table. The inspiration pack is deliberately absent: its
      -- questions are CARDS over a photograph, not sentences, and a home
      -- nothing can produce is a branch nothing tests.
      OR question.value ->> 'home' NOT IN ('INTAKE','FOLLOW_UP')
      OR jsonb_typeof(question.value -> 'evidence') IS DISTINCT FROM 'string'
      OR length(question.value ->> 'evidence') NOT BETWEEN 1 AND 300
      OR jsonb_typeof(question.value -> 'options') IS DISTINCT FROM 'array'
      OR jsonb_array_length(question.value -> 'options') NOT BETWEEN 1 AND 6
      OR EXISTS (
        SELECT 1
        FROM jsonb_array_elements(question.value -> 'options') AS option(value)
        WHERE jsonb_typeof(option.value) IS DISTINCT FROM 'object'
          OR NOT option.value ?& ARRAY['value','label']
          OR option.value - ARRAY['value','label'] <> '{}'::jsonb
          OR jsonb_typeof(option.value -> 'value') IS DISTINCT FROM 'string'
          OR option.value ->> 'value' !~ '^[a-z0-9][a-z0-9-]{0,63}$'
          OR jsonb_typeof(option.value -> 'label') IS DISTINCT FROM 'string'
          OR length(option.value ->> 'label') NOT BETWEEN 1 AND 120
      )
  ) THEN
    RAISE EXCEPTION 'invalid consult follow-up questions' USING ERRCODE = '23514';
  END IF;

  -- Two questions in one round may not ask the same thing.
  IF (SELECT count(DISTINCT question.value ->> 'key')
      FROM jsonb_array_elements(NEW."questions") AS question(value))
     <> jsonb_array_length(NEW."questions")
  THEN
    RAISE EXCEPTION 'consult follow-up round asks one key twice' USING ERRCODE = '23514';
  END IF;

  -- Answers: keys and enums only, the same shapes the inspiration payload
  -- guard enforces, and never more keys than the round has questions.
  IF (SELECT count(*) FROM jsonb_object_keys(NEW."answers")) > jsonb_array_length(NEW."questions")
    OR EXISTS (
      SELECT 1
      FROM jsonb_each(NEW."answers") AS answer(key, value)
      WHERE answer.key !~ '^[a-z][a-z0-9_]{0,63}$'
        OR jsonb_typeof(answer.value) IS DISTINCT FROM 'array'
        OR jsonb_array_length(answer.value) NOT BETWEEN 1 AND 8
        OR jsonb_array_length(answer.value) <> (
          SELECT count(DISTINCT selected.value)
          FROM jsonb_array_elements_text(answer.value) selected(value)
        )
        OR EXISTS (
          SELECT 1 FROM jsonb_array_elements(answer.value) AS selected(value)
          WHERE jsonb_typeof(selected.value) IS DISTINCT FROM 'string'
        )
        OR EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(answer.value) AS selected(value)
          WHERE selected.value !~ '^[a-z0-9][a-z0-9-]{0,63}$'
        )
    )
  THEN
    RAISE EXCEPTION 'invalid consult follow-up answers' USING ERRCODE = '23514';
  END IF;

  -- 🔴 An answer may only ever be stored here for a question whose home IS
  -- here. An INTAKE-keyed answer landing in this table is the "two homes for
  -- one vocabulary" bug, and it is refused rather than trusted to application
  -- code that could be called from somewhere new tomorrow.
  IF EXISTS (
    SELECT 1
    FROM jsonb_object_keys(NEW."answers") AS answered(key)
    WHERE NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(NEW."questions") AS question(value)
      WHERE question.value ->> 'key' = answered.key
        AND question.value ->> 'home' = 'FOLLOW_UP'
    )
  ) THEN
    RAISE EXCEPTION 'consult follow-up answer belongs to another vocabulary home'
      USING ERRCODE = '23514';
  END IF;

  -- A FALLBACK round is the pack's own safety questions, which no model wrote.
  IF (NEW."status" = 'FALLBACK') <> (NEW."model" IS NULL) THEN
    RAISE EXCEPTION 'consult follow-up model must be set exactly when the round was generated'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS "consult_follow_up_round_guard" ON "ConsultFollowUpRound";
CREATE TRIGGER "consult_follow_up_round_guard"
BEFORE INSERT OR UPDATE ON "ConsultFollowUpRound"
FOR EACH ROW EXECUTE FUNCTION public.consult_follow_up_round_guard();

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Sixteen values in an answer array, where there were eight
-- ─────────────────────────────────────────────────────────────────────────────
-- P5g's region cards let a client tap every attribute her photograph was read
-- as. Hair colour has exactly EIGHT, so "I love all of it" sat precisely on the
-- old ceiling with nothing to spare, and the first family with a ninth readable
-- attribute would have hit a 23514 at her last tap.
--
-- Sixteen is the same kind of number the old eight was — a ceiling that stops a
-- payload becoming unbounded, not a product rule. It is raised now rather than
-- when it breaks, because the failure mode is a client losing an answer she
-- already gave.
--
-- The function below is byte-identical to the one 20261012000000 installed
-- except for that single `8` → `16`. It is expand-only: every payload the
-- currently deployed code writes still validates.

CREATE OR REPLACE FUNCTION "consult_inspiration_payload_guard"() RETURNS TRIGGER AS $$
DECLARE answer_count INTEGER; specific_count INTEGER;
BEGIN
  IF NEW."kind" <> 'INSPIRATION' THEN RETURN NEW; END IF;

  -- ── The v2 arm: an envelope, a shape, and the content regex ──────────────
  IF NEW."schemaVersion" = 2 THEN
    IF NEW."model" IS NOT NULL OR NEW."promptVersion" IS NOT NULL
      OR jsonb_typeof(NEW."payload") IS DISTINCT FROM 'object'
      OR NOT NEW."payload" ?& ARRAY['packId','packVersion','schemaVersion','source','inspirationId','complete','answers','catalogGuidance']
      OR NEW."payload" - ARRAY['packId','packVersion','schemaVersion','source','inspirationId','complete','answers','catalogGuidance'] <> '{}'::jsonb
      OR jsonb_typeof(NEW."payload" -> 'packId') IS DISTINCT FROM 'string'
      OR NEW."payload" ->> 'packId' !~ '^[a-z][a-z0-9-]{0,63}$'
      OR jsonb_typeof(NEW."payload" -> 'packVersion') IS DISTINCT FROM 'number'
      OR (NEW."payload" -> 'packVersion')::text !~ '^[1-9][0-9]{0,3}$'
      OR NEW."payload" -> 'schemaVersion' IS DISTINCT FROM '2'::jsonb
      OR NEW."payload" ->> 'source' NOT IN ('NONE','PLATFORM_LOOK','BOOKED_PRO_LOOK','EXTERNAL_UPLOAD')
      OR jsonb_typeof(NEW."payload" -> 'complete') IS DISTINCT FROM 'boolean'
      OR jsonb_typeof(NEW."payload" -> 'answers') IS DISTINCT FROM 'object'
      OR jsonb_typeof(NEW."payload" -> 'catalogGuidance') IS DISTINCT FROM 'array'
      -- Word for word from the v1 arm below. This is the one rule that must
      -- never be relaxed as packs multiply: the guided step records what a
      -- client liked about a PICTURE, never anything about a person.
      OR NEW."payload"::text ~* '\m(face|eyes?|skin|undertone|identity|ethnic|ethnicity|race|health)\M'
      OR NEW."payload"::text ~* '"(base64|bytes|signedUrl|token|storagePath|storageBucket|providerRequest|providerResponse|hiddenReasoning)"[[:space:]]*:'
    THEN RAISE EXCEPTION 'invalid guided inspiration payload' USING ERRCODE = '23514'; END IF;

    IF (NEW."payload" ->> 'source' = 'NONE' AND (
          NEW."payload" -> 'inspirationId' <> 'null'::jsonb
          OR NEW."payload" -> 'answers' <> '{}'::jsonb
          OR NEW."payload" -> 'complete' <> 'true'::jsonb))
      OR (NEW."payload" ->> 'source' <> 'NONE' AND (
            jsonb_typeof(NEW."payload" -> 'inspirationId') IS DISTINCT FROM 'string'
            OR length(NEW."payload" ->> 'inspirationId') NOT BETWEEN 1 AND 64))
      -- A ceiling on how much a pack can ask, so no pack can turn one revision
      -- into an unbounded document.
      OR (SELECT count(*) FROM jsonb_object_keys(NEW."payload" -> 'answers')) > 32
      -- Keys and enums ONLY. A slug-shaped question key, a small array of
      -- DISTINCT token-shaped values, and no other JSON type anywhere in it.
      OR EXISTS (
        SELECT 1
        FROM jsonb_each(NEW."payload" -> 'answers') AS answer(key, value)
        WHERE answer.key !~ '^[a-z][a-z0-9_]{0,63}$'
          OR jsonb_typeof(answer.value) IS DISTINCT FROM 'array'
          OR jsonb_array_length(answer.value) NOT BETWEEN 1 AND 16
          OR EXISTS (
            SELECT 1 FROM jsonb_array_elements(answer.value) AS selected(value)
            WHERE jsonb_typeof(selected.value) IS DISTINCT FROM 'string'
          )
          OR jsonb_array_length(answer.value) <> (
            SELECT count(DISTINCT selected.value)
            FROM jsonb_array_elements_text(answer.value) selected(value)
          )
          OR EXISTS (
            SELECT 1 FROM jsonb_array_elements_text(answer.value) AS selected(value)
            WHERE selected.value !~ '^[a-z0-9][a-z0-9-]{0,63}$'
          )
      )
      -- The catalogue block is enums now: the SENTENCE lives in brand copy and
      -- is filled in on read, so it can be edited without rewriting rows.
      OR jsonb_array_length(NEW."payload" -> 'catalogGuidance') > 3
      OR jsonb_array_length(NEW."payload" -> 'catalogGuidance') <> (
        SELECT count(DISTINCT detail.value)
        FROM jsonb_array_elements_text(NEW."payload" -> 'catalogGuidance') detail(value)
      )
      OR EXISTS (
        SELECT 1
        FROM jsonb_array_elements(NEW."payload" -> 'catalogGuidance') AS detail(value)
        WHERE jsonb_typeof(detail.value) IS DISTINCT FROM 'string'
      )
      OR EXISTS (
        SELECT 1
        FROM jsonb_array_elements_text(NEW."payload" -> 'catalogGuidance') AS detail(value)
        WHERE detail.value NOT IN ('LENGTH','FULLNESS','STYLING')
      )
    THEN RAISE EXCEPTION 'invalid guided inspiration review' USING ERRCODE = '23514'; END IF;
    RETURN NEW;
  END IF;

  -- ── The v1 arm: exactly the rules from 20260913000001, unchanged ─────────
  IF NEW."schemaVersion" <> 1 OR NEW."model" IS NOT NULL OR NEW."promptVersion" IS NOT NULL
    OR jsonb_typeof(NEW."payload") IS DISTINCT FROM 'object'
    OR NEW."payload" - ARRAY['contractId','contractVersion','schemaVersion','source','inspirationId','complete','answers','exactClientDetails','possibleProfessionalInterpretation','catalogGuidance'] <> '{}'::jsonb
    OR NEW."payload" ->> 'contractId' IS DISTINCT FROM 'hair-color-guided-inspiration'
    OR NEW."payload" -> 'contractVersion' IS DISTINCT FROM '1'::jsonb
    OR NEW."payload" -> 'schemaVersion' IS DISTINCT FROM '1'::jsonb
    OR NEW."payload" ->> 'source' NOT IN ('NONE','PLATFORM_LOOK','BOOKED_PRO_LOOK','EXTERNAL_UPLOAD')
    OR jsonb_typeof(NEW."payload" -> 'complete') IS DISTINCT FROM 'boolean'
    OR jsonb_typeof(NEW."payload" -> 'answers') IS DISTINCT FROM 'array'
    OR jsonb_typeof(NEW."payload" -> 'exactClientDetails') IS DISTINCT FROM 'array'
    OR jsonb_typeof(NEW."payload" -> 'possibleProfessionalInterpretation') IS DISTINCT FROM 'array'
    OR jsonb_typeof(NEW."payload" -> 'catalogGuidance') IS DISTINCT FROM 'array'
    OR NEW."payload"::text ~* '\m(face|eyes?|skin|undertone|identity|ethnic|ethnicity|race|health)\M'
    OR NEW."payload"::text ~* '"(base64|bytes|signedUrl|token|storagePath|storageBucket|providerRequest|providerResponse|hiddenReasoning)"[[:space:]]*:'
  THEN RAISE EXCEPTION 'invalid guided inspiration payload' USING ERRCODE = '23514'; END IF;
  answer_count := jsonb_array_length(NEW."payload" -> 'answers');
  SELECT count(*)::integer INTO specific_count FROM (
    SELECT 1
    FROM jsonb_array_elements(NEW."payload" -> 'answers') answer,
      LATERAL jsonb_array_elements_text(COALESCE(answer -> 'selectedValues', '[]'::jsonb)) selected(value)
    WHERE answer ->> 'questionKey' <> 'styling_walkthrough'
      AND selected.value NOT IN ('none', 'not-sure', 'not-part-of-goal', 'nothing-else')
    UNION ALL
    SELECT 1
    FROM jsonb_array_elements(NEW."payload" -> 'answers') answer
    WHERE answer ->> 'questionKey' = 'other_detail'
      AND NULLIF(btrim(COALESCE(answer ->> 'text', '')), '') IS NOT NULL
  ) specific_details;
  IF (NEW."payload" ->> 'source' = 'NONE' AND (NEW."payload" -> 'inspirationId' <> 'null'::jsonb OR answer_count <> 0 OR NEW."payload" -> 'complete' <> 'true'::jsonb))
    OR (NEW."payload" ->> 'source' <> 'NONE' AND jsonb_typeof(NEW."payload" -> 'inspirationId') IS DISTINCT FROM 'string')
    OR answer_count > 7
    OR answer_count <> (SELECT count(DISTINCT answer ->> 'questionKey') FROM jsonb_array_elements(NEW."payload" -> 'answers') answer)
    OR (NEW."payload" -> 'complete' = 'true'::jsonb AND NEW."payload" ->> 'source' <> 'NONE' AND (answer_count <> 7 OR specific_count < 3))
    OR EXISTS (
      SELECT 1 FROM jsonb_array_elements(NEW."payload" -> 'answers') answer
      WHERE answer - ARRAY['questionKey','selectedValues','text','sentiment'] <> '{}'::jsonb
        OR NOT (answer ?& ARRAY['questionKey','selectedValues','text','sentiment'])
        OR answer ->> 'questionKey' NOT IN ('favorite_colors','avoid_colors','length_goal','fullness_goal','current_styling','styling_walkthrough','other_detail')
        OR jsonb_typeof(answer -> 'selectedValues') IS DISTINCT FROM 'array'
        OR jsonb_array_length(answer -> 'selectedValues') <> (
          SELECT count(DISTINCT selected.value)
          FROM jsonb_array_elements_text(answer -> 'selectedValues') selected(value)
        )
        OR jsonb_typeof(answer -> 'text') NOT IN ('string', 'null')
        OR jsonb_typeof(answer -> 'sentiment') NOT IN ('string', 'null')
        OR CASE answer ->> 'questionKey'
          WHEN 'favorite_colors' THEN jsonb_array_length(answer -> 'selectedValues') NOT BETWEEN 1 AND 4
          WHEN 'avoid_colors' THEN jsonb_array_length(answer -> 'selectedValues') NOT BETWEEN 1 AND 4
          WHEN 'other_detail' THEN jsonb_array_length(answer -> 'selectedValues') NOT BETWEEN 0 AND 1
          ELSE jsonb_array_length(answer -> 'selectedValues') <> 1
        END
        OR EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(answer -> 'selectedValues') selected(value)
          WHERE NOT CASE answer ->> 'questionKey'
            WHEN 'favorite_colors' THEN selected.value IN ('lightest-pieces','darkest-pieces','warm-golden','cool-smoky','copper-red','whole-color-mix','not-sure')
            WHEN 'avoid_colors' THEN selected.value IN ('lightest-pieces','darkest-pieces','warm-golden','cool-smoky','copper-red','none','not-sure')
            WHEN 'length_goal' THEN selected.value IN ('yes-same-length','longer','shorter','not-part-of-goal','not-sure')
            WHEN 'fullness_goal' THEN selected.value IN ('yes-same-fullness','more-full','less-full','not-part-of-goal','not-sure')
            WHEN 'current_styling' THEN selected.value IN ('yes-often','sometimes','no','not-sure')
            WHEN 'styling_walkthrough' THEN selected.value IN ('yes','no','not-sure')
            WHEN 'other_detail' THEN selected.value = 'nothing-else'
            ELSE FALSE
          END
        )
        OR (jsonb_array_length(answer -> 'selectedValues') > 1 AND EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(answer -> 'selectedValues') selected(value)
          WHERE selected.value IN ('none','not-sure','not-part-of-goal','nothing-else')
        ))
        OR (answer ->> 'questionKey' <> 'other_detail' AND (answer -> 'text' <> 'null'::jsonb OR answer -> 'sentiment' <> 'null'::jsonb))
        OR (answer ->> 'questionKey' = 'other_detail' AND NOT (
          (answer -> 'selectedValues' = '["nothing-else"]'::jsonb AND answer -> 'text' = 'null'::jsonb AND answer ->> 'sentiment' = 'NONE')
          OR (answer -> 'selectedValues' = '[]'::jsonb AND jsonb_typeof(answer -> 'text') = 'string' AND length(btrim(answer ->> 'text')) BETWEEN 1 AND 240 AND answer ->> 'sentiment' IN ('GOOD','BAD','BOTH'))
        ))
    )
  THEN RAISE EXCEPTION 'invalid guided inspiration review' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
