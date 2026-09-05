-- P5c: the guided inspiration becomes a per-family CONTRACT instead of one
-- hard-coded hair-colour questionnaire.
--
-- Contract v1 wrote the same seven colour questions into every consult, and
-- this trigger wrote them a second time: the question keys, every option
-- value, the per-question selection bounds, the free-text rules, the
-- seven-answer count and the three-detail completion gate are all spelled out
-- in `consult_inspiration_payload_guard` today. A category outside hair could
-- not be asked one different question without a migration, which is why every
-- non-colour consult has been asking about "the warm or golden colors".
--
-- v2 moves the vocabulary into DATA (lib/consult/inspiration/packs/) and
-- leaves the database guarding what a database can actually guard:
--
--   * the ENVELOPE — exactly these eight keys, this schema version, a
--     slug-shaped pack id and a positive pack version, a known source, and the
--     source/inspirationId pairing that says whether she brought a picture;
--   * the SHAPE of the answers — a slug-shaped question key mapping to a small
--     array of DISTINCT token-shaped values. Keys and enums, nothing else:
--     there is no free text in a v2 payload, so there is nothing for a payload
--     to smuggle a sentence in;
--   * the CONTENT regex, unchanged and word-for-word from v1 — no appearance
--     or identity language, no object material, no provider dumps.
--
-- What it deliberately stops guarding, because it cannot do so without pinning
-- one family's questions again:
--
--   * WHICH keys and values exist. That is the pack's, and
--     `resolveConsultInspirationPayloadV2` refuses a payload whose answers the
--     pack does not know — on the write path AND on every read.
--   * the three-detail gate. It is gone from the product, not just from here:
--     it could not be satisfied by a client who genuinely did not mind, and it
--     sent her back to a question she had already answered.
--
-- 🔴 THE GUARD ACCEPTS BOTH CONTRACTS, and that is not indecision — it is the
-- migrate-before-deploy window.
--
-- `migrate-deploy.yml` migrates production on every push to `main`, while
-- deploys are manual and need Tori's authorization, so production runs the NEW
-- schema against the OLD code for as long as that gap lasts. A guard that
-- accepted only v2 would refuse every guided-inspiration answer the
-- still-deployed code writes, and every consult in that window would stop at
-- the inspiration step. So this is an EXPAND: the v1 arm below is
-- byte-for-byte the rules from 20260913000001, and the v2 arm is additive.
-- Neither is loosened. Dropping the v1 arm is NOT a follow-up here, and that
-- is a difference from P5b: a consult that started on v1 keeps writing v1 for
-- the rest of its life (`resolveConsultSessionInspirationPack`), so the arm
-- retires when the last v1 consult does, not when the deploy lands.
--
-- Read side: `normalizeStoredInspirationPayload` tries v1 FIRST and is
-- unchanged, so no stored row changes meaning. The two shapes are disjoint —
-- v1 requires `contractId`, v2 requires `packId`, and each requires its own
-- exact key set — so no row can satisfy both arms.
--
-- Swept against the LIVE definitions in a fully-migrated database (local
-- tovis_test, 2026-09-05), not reconstructed from the migration chain:
--   SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public' AND p.prokind = 'f'
--      AND pg_get_functiondef(p.oid) LIKE '%hair-color-guided-inspiration%';
--   -- consult_inspiration_payload_guard, and nothing else
--   SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public' AND p.prokind = 'f'
--      AND pg_get_functiondef(p.oid) LIKE '%consult_current_inspiration_complete%';
--   -- consult_lifecycle_guard (the booking gate) and the function itself
--   SELECT conname FROM pg_constraint
--    WHERE pg_get_constraintdef(oid) LIKE '%exactClientDetails%';
--   -- no rows
--
-- `consult_brief_payload_guard` also names the derived arrays, and is NOT
-- touched: it requires `inspiration.exactClientDetails`,
-- `possibleProfessionalInterpretation` and `catalogGuidance` to be arrays, and
-- a v2 review still produces all three — DERIVED from its pack on read rather
-- than stored in the row.

-- 1) The payload guard ------------------------------------------------------
-- Re-issued in full (current definition = 20260913000001). The v1 arm is that
-- definition unchanged, moved under a version check; the v2 arm is new.

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
          OR jsonb_array_length(answer.value) NOT BETWEEN 1 AND 8
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
ALTER FUNCTION "consult_inspiration_payload_guard"() SET search_path = '';

-- 2) The booking gate -------------------------------------------------------
-- `consult_current_inspiration_complete` is what `consult_lifecycle_guard`
-- asks before a consult may be booked. It pinned `schemaVersion = 1`, so the
-- moment a consult wrote a v2 inspiration it would have read as "no inspiration
-- at all" and the booking would have been refused. It now admits both.
--
-- Everything else is byte-for-byte the definition from 20260913000001 — the
-- acceptance window, the source pairing and the `consult_inspiration_source_valid`
-- call are untouched. Both contracts spell `complete`, `source` and
-- `inspirationId` the same way at the top level, which is why one predicate
-- can read either.

CREATE OR REPLACE FUNCTION "consult_current_inspiration_complete"(session_id TEXT)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public."ConsultRevision" review
    WHERE review."id" = (
      SELECT latest."id"
      FROM public."ConsultRevision" latest
      WHERE latest."consultSessionId" = session_id
        AND latest."kind" = 'INSPIRATION'
      ORDER BY latest."revision" DESC
      LIMIT 1
    )
      AND review."schemaVersion" IN (1, 2)
      AND review."payload" -> 'complete' = 'true'::jsonb
      AND review."createdAt" >= COALESCE((
        SELECT max(acceptance."acceptedAt")
        FROM public."ConsultAgreementAcceptance" acceptance
        WHERE acceptance."consultSessionId" = session_id
          AND acceptance."revokedAt" IS NULL
      ), 'infinity'::timestamp)
      AND (
        review."payload" ->> 'source' = 'NONE'
        OR EXISTS (
          SELECT 1
          FROM public."ConsultInspiration" inspiration_source
          WHERE inspiration_source."id" = review."payload" ->> 'inspirationId'
            AND inspiration_source."consultSessionId" = session_id
            AND inspiration_source."status" = 'ATTACHED'
            AND inspiration_source."source"::text = review."payload" ->> 'source'
            AND public."consult_inspiration_source_valid"(inspiration_source)
        )
      )
  );
$$ LANGUAGE sql STABLE;
ALTER FUNCTION "consult_current_inspiration_complete"(TEXT) SET search_path = '';

-- 3) Prove both landed ------------------------------------------------------
-- A CREATE OR REPLACE that silently did not apply is the failure mode this
-- repo has been bitten by before, so the migration asserts against the LIVE
-- definitions rather than assuming its own SQL took effect.

DO $$
BEGIN
  IF position('NEW."schemaVersion" = 2' in pg_get_functiondef(
    'public.consult_inspiration_payload_guard()'::regprocedure)) = 0
  THEN
    RAISE EXCEPTION 'inspiration payload guard did not gain its v2 arm';
  END IF;
  IF position('hair-color-guided-inspiration' in pg_get_functiondef(
    'public.consult_inspiration_payload_guard()'::regprocedure)) = 0
  THEN
    RAISE EXCEPTION 'inspiration payload guard lost its v1 arm';
  END IF;
  IF position('"schemaVersion" IN (1, 2)' in pg_get_functiondef(
    'public.consult_current_inspiration_complete(text)'::regprocedure)) = 0
  THEN
    RAISE EXCEPTION 'inspiration completion predicate still pins schema 1';
  END IF;
END;
$$;
