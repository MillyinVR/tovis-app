-- C2-6b (gap G2): inspiration analysis schema v4 / prompt `inspiration-hair-color-v4`.
--
-- The reference read gains `credibilityFlags` — what the reader noticed about
-- the PHOTOGRAPH rather than the hair (a filter or edit, an AI-looking image,
-- added hair, studio light, styling that hides the cut, a single angle). The
-- READING is unchanged: the eight attributes, their validator and the level
-- ordering rule are the v3 arm's, untouched. A flag is a note, never a refusal.
--
-- 🔴 `consult_inspiration_analysis_payload_guard` pins BOTH the schema version
-- and the prompt version. Same trap as every other consult version bump: move
-- the TypeScript constant alone and the insert raises
--   23514 "invalid versioned inspiration analysis payload"
-- after the paid vision call has already been made.
--
-- 🔴 PATCHED, NOT RETYPED — and the first draft of this very migration is why.
-- The guard's body in the migration files is 20261011000000, but the LIVE body
-- has since been patched in place by FOUR migrations that each read it back
-- with pg_get_functiondef and replaced one substring: 20261015000001 (rerun:
-- COMPLETED admitted), 20261020000000 (visual reference: EARLY_PHOTO_READY
-- admitted), 20261023000001 and 20261027000000 (prompt v2 OR v3 — in BOTH
-- arms, because replace() is global). A full re-issue copied from the files
-- silently dropped all four, and the app's own v4 write was refused with
-- 23514 on the first integration run. So this migration does what those four
-- did: read the live definition, assert the one marker it needs, insert the
-- v4 arm in front of the v3 arm, and execute — "the rest is unchanged" is then
-- true by construction, whatever the live body is.
--
-- 🔴 THE GUARD KEEPS EVERY EARLIER ARM (the migrate-before-deploy window, see
-- 20261011000000): a production deploy applies this migration INSIDE the
-- Vercel build while the previous deployment is still serving, so for the
-- length of that build the OLD code writes v3 artefacts against the NEW guard.
-- The v3 arm is not touched by one byte.
--
-- The v4 arm is the v3 arm's rules (same lifecycle states, same row pin, same
-- attribute validator, same content regex, same level ordering) plus:
--   * schemaVersion 4 / promptVersion 'inspiration-hair-color-v4'
--   * a required `credibilityFlags` key on the payload — a JSON array whose
--     every element is one of the six values, with no duplicates. The
--     TypeScript sanitizer DROPS an unknown value and dedupes before storing
--     (a flag is advisory, and a whole paid reading is not thrown away over a
--     word); the guard refuses what the sanitizer would never write, so a
--     direct SQL writer cannot store a code no copy table has words for.
--
-- Read side (lib/consult/inspirationAnalysisRead.ts) accepts v3 AND v4, with
-- `credibilityFlags` defaulting to [] on a v3 row — a bare bump there would
-- have blanked the pro's reading, the client's card crops and the top line's
-- region words for every consult read before the deploy. The request hash
-- includes both versions, so a v3-read photograph is re-read once under v4 the
-- next time an analysis run or the read stage asks for it; v3 rows are left
-- as they are.
--
-- Swept against the live definitions in a fully-migrated database (a fresh
-- replay of the chain to 20261028000001, 2026-09-11):
--   SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public' AND p.prokind = 'f'
--      AND pg_get_functiondef(p.oid) LIKE '%inspiration-hair-color-%';
--   -- consult_inspiration_analysis_payload_guard, and nothing else
--   SELECT conname FROM pg_constraint
--    WHERE pg_get_constraintdef(oid) LIKE '%inspiration-hair-color-%';
--   -- no rows

-- 1) The flag-list validator ----------------------------------------------
-- Its own function, like `consult_inspiration_region_valid`: the v4 arm reads
-- as one predicate per rule, and a later version can reuse it.

CREATE OR REPLACE FUNCTION "consult_inspiration_credibility_flags_valid"(value JSONB)
RETURNS BOOLEAN AS $$
  SELECT jsonb_typeof(value) = 'array'
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(value) AS flag(item)
      WHERE jsonb_typeof(flag.item) <> 'string'
         OR flag.item #>> '{}' NOT IN (
           'LIKELY_EDITED', 'LIKELY_AI_GENERATED', 'EXTENSIONS_LIKELY',
           'PRO_LIGHTING', 'FINISH_HIDES_CUT', 'SINGLE_ANGLE'
         )
    )
    AND (
      SELECT count(*) = count(DISTINCT flag.item)
      FROM jsonb_array_elements_text(value) AS flag(item)
    );
$$ LANGUAGE sql IMMUTABLE;
ALTER FUNCTION "consult_inspiration_credibility_flags_valid"(JSONB) SET search_path = '';

-- 2) The v4 arm, inserted in front of the v3 arm ---------------------------
-- The marker is the v3 arm's opening — its first two predicates, which name
-- its lifecycle states (20261020000000) and its schema version
-- (20261011000000). Both are asserted present and unique, so a drifted
-- definition fails loudly instead of being silently unpatched.
-- Re-runnable: once the v4 prompt is in the body, this is a no-op.

DO $patch$
DECLARE
  body TEXT;
  marker TEXT;
  v4_arm TEXT;
  patched TEXT;
BEGIN
  SELECT pg_get_functiondef('public.consult_inspiration_analysis_payload_guard()'::regprocedure)
    INTO body;
  IF body IS NULL THEN
    RAISE EXCEPTION 'C2-6b: consult_inspiration_analysis_payload_guard() not found';
  END IF;
  IF position('inspiration-hair-color-v4' IN body) > 0 THEN
    RETURN;  -- already patched
  END IF;

  -- The v3 arm's first two predicates: its four lifecycle states
  -- (20261020000000) and its schema pin (20261011000000). No other arm has
  -- this pair, and the heading comment above them is left where it is.
  marker := E'  IF session_status NOT IN (''EARLY_PHOTO_READY'', ''MEDIA_READY'', ''ANALYZING'', ''COMPLETED'')'
    || E'\n    OR NEW."schemaVersion" <> 3\n';
  IF position(marker IN body) = 0 THEN
    RAISE EXCEPTION 'C2-6b: the v3 arm of consult_inspiration_analysis_payload_guard() was not found where expected; refusing to patch a drifted definition';
  END IF;
  IF length(body) - length(replace(body, marker, '')) <> length(marker) THEN
    RAISE EXCEPTION 'C2-6b: the v3 arm marker is not unique in consult_inspiration_analysis_payload_guard()';
  END IF;

  v4_arm := $v4$  -- ── The v4 arm (C2-6b): the v3 arm's rules plus `credibilityFlags` ──────
  -- (Inserted in front of the v3 arm by 20261029000000; the v3 arm follows,
  -- byte for byte.)
  IF NEW."schemaVersion" = 4 THEN
    IF session_status NOT IN ('EARLY_PHOTO_READY', 'MEDIA_READY', 'ANALYZING', 'COMPLETED')
      OR NEW."promptVersion" IS DISTINCT FROM 'inspiration-hair-color-v4'
      OR NEW."model" IS NULL
      OR btrim(NEW."model") <> NEW."model"
      OR length(NEW."model") NOT BETWEEN 1 AND 128
      OR jsonb_typeof(NEW."payload") IS DISTINCT FROM 'object'
      OR NOT NEW."payload" ?& ARRAY[
        'schemaVersion', 'inspirationId', 'source', 'attributes', 'credibilityFlags'
      ]
      OR NEW."payload" - ARRAY[
        'schemaVersion', 'inspirationId', 'source', 'attributes', 'credibilityFlags'
      ] <> '{}'::jsonb
      OR NEW."payload" -> 'schemaVersion' <> '4'::jsonb
      OR jsonb_typeof(NEW."payload" -> 'inspirationId') IS DISTINCT FROM 'string'
      OR length(NEW."payload" ->> 'inspirationId') NOT BETWEEN 1 AND 64
      OR NEW."payload" ->> 'source' NOT IN ('PLATFORM_LOOK', 'BOOKED_PRO_LOOK', 'EXTERNAL_UPLOAD')
      -- The artefact is pinned to the inspiration ROW it read, which must be
      -- the ATTACHED reference on THIS consult, and whose own source must match
      -- what the artefact claims to have read.
      OR NOT EXISTS (
        SELECT 1
        FROM public."ConsultInspiration" AS attached
        WHERE attached."id" = NEW."payload" ->> 'inspirationId'
          AND attached."consultSessionId" = NEW."consultSessionId"
          AND attached."status" = 'ATTACHED'
          AND attached."source"::text = NEW."payload" ->> 'source'
      )
      OR NOT public."consult_inspiration_attributes_valid"(NEW."payload" -> 'attributes')
      -- C2-6b: the six flag values, each at most once. An empty array is the
      -- ordinary case.
      OR NOT public."consult_inspiration_credibility_flags_valid"(NEW."payload" -> 'credibilityFlags')
      -- No C3 object material, no provider dumps, and none of the person in
      -- the photograph — this artefact is about hair colour and holds no free
      -- text.
      OR NEW."payload"::text ~* '"(base64|bytes|signedUrl|token|storagePath|storageBucket|rawPath|providerRequest|providerResponse|hiddenReasoning|identity|ethnicity|health)"[[:space:]]*:'
    THEN
      RAISE EXCEPTION 'invalid versioned inspiration analysis payload'
        USING ERRCODE = '23514';
    END IF;
    base_level := NEW."payload" #>> '{attributes,baseLevel,value}';
    lightest_level := NEW."payload" #>> '{attributes,lightestLevel,value}';
    IF base_level <> 'UNKNOWN' AND lightest_level <> 'UNKNOWN'
      AND split_part(base_level, '_', 2)::int > split_part(lightest_level, '_', 2)::int
    THEN
      RAISE EXCEPTION 'inspiration base level is lighter than its lightest level'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  -- ── The v3 arm: the read stage's own shape (unchanged) ─────────────────
$v4$;

  patched := replace(body, marker, v4_arm || marker);
  IF patched = body THEN
    RAISE EXCEPTION 'C2-6b: patching consult_inspiration_analysis_payload_guard() changed nothing';
  END IF;
  EXECUTE patched;
END
$patch$;
ALTER FUNCTION "consult_inspiration_analysis_payload_guard"() SET search_path = '';
