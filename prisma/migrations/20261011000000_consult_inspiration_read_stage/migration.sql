-- P5b: the inspiration read becomes its own stage, in MEDIA_READY.
--
-- P5's cards are generated FROM the vision reading of the client's reference,
-- and they are shown BEFORE she has answered anything about it. The reading
-- therefore cannot stay inside the analysis run: that run cannot start until
-- the guided-inspiration step is complete, which is the very step the cards
-- replace. Two things in the database say otherwise today, and both are
-- rewritten here.
--
--   1. consult_revision_requires_agreements pins INSPIRATION_ANALYSIS to
--      ANALYZING. It now admits MEDIA_READY as well — the state the client is
--      in while she is choosing and reviewing a reference. Nothing else about
--      the pin changes: every other kind keeps the states it had.
--   2. consult_inspiration_analysis_payload_guard pins the artefact to the
--      LATEST INSPIRATION revision. At read time there is no such revision —
--      the first one is written by her first answer — so the pin refuses every
--      write this stage would make. It is replaced by a pin to the
--      ConsultInspiration ROW the reading is of, which is the thing the
--      artefact actually describes, and which must be ATTACHED to this
--      consult.
--
-- The revision pin was also a standing double charge in the application: the
-- artefact's request hash included the revision id, every answer wrote a new
-- revision, so by analysis time the hash never matched and the same photograph
-- was read and billed a second time (~$0.012/consult). Both halves move to the
-- row together — see lib/consult/inspirationAnalysisContract.ts.
--
-- Payload schema 2 -> 3 (the ENVELOPE loses `inspirationRevisionId`; the
-- reading itself is unchanged, so `promptVersion` stays
-- 'inspiration-hair-color-v2' and a v2 and a v3 reading of one photograph are
-- the same reading).
--
-- 🔴 THE GUARD ACCEPTS BOTH VERSIONS, and that is not indecision — it is the
-- migrate-before-deploy window.
--
-- `migrate-deploy.yml` migrates production on every push to `main`, while
-- deploys are manual and need Tori's authorization, so production runs the NEW
-- schema against the OLD code for as long as that gap lasts. A guard that
-- accepted only schema 3 would refuse every artefact the still-deployed code
-- writes — 23514, raised AFTER the vision call has been billed — and every
-- consult analysis in that window would fail. So this is an EXPAND: v2 rows
-- keep their own rules (including their revision pin), v3 rows get the new
-- ones, and neither is loosened. The contract half — dropping the v2 arm — is
-- a follow-up migration to run once the deploy has landed.
--
-- Read side is forward-only regardless: `normalizeStoredConsultInspirationAnalysis`
-- accepts schema 3 alone, so a stored v2 artefact reads as absent. Blast radius
-- is one field on the pro brief (`inspirationAnalysis` shows nothing instead of
-- the reading) for a consult that already holds a v2 artefact, and that
-- consult's next analysis run re-reads the reference once.
--
-- Swept against the LIVE definitions in a fully-migrated database (local
-- tovis_test, 2026-09-05), not reconstructed from the migration chain:
--   SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public' AND p.prokind = 'f'
--      AND pg_get_functiondef(p.oid) LIKE '%inspirationRevisionId%';
--   -- consult_inspiration_analysis_payload_guard, and nothing else
--   SELECT conname FROM pg_constraint
--    WHERE pg_get_constraintdef(oid) LIKE '%inspirationRevisionId%';
--   -- no rows

-- 1) The lifecycle pin ------------------------------------------------------
-- Same pg_get_functiondef rewrite the P4 slice used, with the same assertion
-- so a drifted definition fails loudly instead of silently not applying.

DO $$
DECLARE
  definition TEXT;
  updated TEXT;
BEGIN
  SELECT pg_get_functiondef('public.consult_revision_requires_agreements()'::regprocedure)
    INTO definition;

  updated := replace(
    definition,
    'IF NEW."kind" = ''INSPIRATION_ANALYSIS'' AND session_status <> ''ANALYZING'' THEN',
    'IF NEW."kind" = ''INSPIRATION_ANALYSIS'' AND session_status NOT IN (''MEDIA_READY'', ''ANALYZING'') THEN'
  );
  IF updated = definition THEN
    RAISE EXCEPTION 'expected inspiration analysis lifecycle pin not found';
  END IF;
  IF position('NOT IN (''MEDIA_READY'', ''ANALYZING'')' in updated) = 0 THEN
    RAISE EXCEPTION 'inspiration analysis lifecycle pin was not widened';
  END IF;

  EXECUTE updated;
END;
$$;
ALTER FUNCTION "consult_revision_requires_agreements"() SET search_path = '';

-- 2a) The attribute contract, hoisted --------------------------------------
-- Identical for schema 2 and schema 3: only the ENVELOPE changed. Hoisted so
-- the two arms below cannot drift into two different ideas of what a valid
-- reading is — the exact duplication risk that a two-version window creates.

CREATE OR REPLACE FUNCTION "consult_inspiration_attributes_valid"(attributes JSONB)
RETURNS BOOLEAN AS $$
  SELECT jsonb_typeof(attributes) = 'object'
    AND attributes ?& ARRAY[
      'baseLevel', 'lightestLevel', 'tone', 'technique', 'placement',
      'rootBlend', 'finish', 'dimension'
    ]
    AND attributes - ARRAY[
      'baseLevel', 'lightestLevel', 'tone', 'technique', 'placement',
      'rootBlend', 'finish', 'dimension'
    ] = '{}'::jsonb
    AND public."consult_inspiration_observation_valid"(
      attributes -> 'baseLevel',
      ARRAY[
        'LEVEL_1', 'LEVEL_2', 'LEVEL_3', 'LEVEL_4', 'LEVEL_5',
        'LEVEL_6', 'LEVEL_7', 'LEVEL_8', 'LEVEL_9', 'LEVEL_10', 'UNKNOWN'
      ]
    )
    AND public."consult_inspiration_observation_valid"(
      attributes -> 'lightestLevel',
      ARRAY[
        'LEVEL_1', 'LEVEL_2', 'LEVEL_3', 'LEVEL_4', 'LEVEL_5',
        'LEVEL_6', 'LEVEL_7', 'LEVEL_8', 'LEVEL_9', 'LEVEL_10', 'UNKNOWN'
      ]
    )
    AND public."consult_inspiration_observation_valid"(
      attributes -> 'tone',
      ARRAY['WARM', 'COOL', 'NEUTRAL', 'UNKNOWN']
    )
    AND public."consult_inspiration_observation_valid"(
      attributes -> 'technique',
      ARRAY[
        'SINGLE_PROCESS', 'BALAYAGE', 'FOIL_HIGHLIGHTS', 'BABYLIGHTS',
        'LOWLIGHTS', 'COLOR_MELT', 'GLOSS_ONLY', 'DOUBLE_PROCESS',
        'NATURAL_UNCOLORED', 'UNKNOWN'
      ]
    )
    AND public."consult_inspiration_observation_valid"(
      attributes -> 'placement',
      ARRAY[
        'ALL_OVER', 'FACE_FRAMING', 'MIDS_TO_ENDS', 'ENDS_ONLY',
        'SURFACE_ONLY', 'UNDERNEATH', 'PANELS', 'UNKNOWN'
      ]
    )
    AND public."consult_inspiration_observation_valid"(
      attributes -> 'rootBlend',
      ARRAY['SOLID_TO_ROOT', 'SHADOW_ROOT', 'SEAMLESS_MELT', 'GROWN_OUT', 'UNKNOWN']
    )
    AND public."consult_inspiration_observation_valid"(
      attributes -> 'finish',
      ARRAY['HIGH_SHINE', 'SATIN', 'MATTE', 'UNKNOWN']
    )
    AND public."consult_inspiration_observation_valid"(
      attributes -> 'dimension',
      ARRAY['FLAT', 'SUBTLE', 'MEDIUM', 'HIGH_CONTRAST', 'UNKNOWN']
    )
    -- Part 0 rule 4: an all-UNKNOWN artefact is an unreadable photo, not a
    -- low-confidence answer. It never becomes a stored success.
    AND EXISTS (
      SELECT 1
      FROM jsonb_each(attributes) AS attribute(key, value)
      WHERE attribute.value ->> 'value' <> 'UNKNOWN'
    );
$$ LANGUAGE sql IMMUTABLE;
ALTER FUNCTION "consult_inspiration_attributes_valid"(JSONB) SET search_path = '';

-- 2b) The payload guard ------------------------------------------------------
-- Re-issued in full (current definition = 20261008000001). Changes, and only
-- these: the two states, schemaVersion 3, the dropped `inspirationRevisionId`
-- key, and the row pin that replaces the revision pin — plus the v2 arm that
-- keeps the still-deployed code working until the deploy lands. The attribute
-- contract, the level ordering rule, the all-UNKNOWN refusal and the content
-- regex are byte-identical to the version they came from.

CREATE OR REPLACE FUNCTION "consult_inspiration_analysis_payload_guard"()
RETURNS TRIGGER AS $$
DECLARE
  session_status public."ConsultSessionStatus";
  base_level TEXT;
  lightest_level TEXT;
BEGIN
  IF NEW."kind" <> 'INSPIRATION_ANALYSIS' THEN
    RETURN NEW;
  END IF;

  SELECT "status" INTO session_status
  FROM public."ConsultSession"
  WHERE "id" = NEW."consultSessionId";

  -- ── The v2 arm: exactly the rules from 20261008000001, unchanged ─────────
  -- Kept alive only for the merge-to-deploy window described above. It still
  -- pins ANALYZING and still pins the artefact to the latest INSPIRATION
  -- revision, because that is what the code writing it believes.
  IF NEW."schemaVersion" = 2 THEN
    IF session_status <> 'ANALYZING'
      OR NEW."promptVersion" IS DISTINCT FROM 'inspiration-hair-color-v2'
      OR NEW."model" IS NULL
      OR btrim(NEW."model") <> NEW."model"
      OR length(NEW."model") NOT BETWEEN 1 AND 128
      OR jsonb_typeof(NEW."payload") IS DISTINCT FROM 'object'
      OR NOT NEW."payload" ?& ARRAY[
        'schemaVersion', 'inspirationRevisionId', 'inspirationId', 'source', 'attributes'
      ]
      OR NEW."payload" - ARRAY[
        'schemaVersion', 'inspirationRevisionId', 'inspirationId', 'source', 'attributes'
      ] <> '{}'::jsonb
      OR NEW."payload" -> 'schemaVersion' <> '2'::jsonb
      OR jsonb_typeof(NEW."payload" -> 'inspirationRevisionId') IS DISTINCT FROM 'string'
      OR length(NEW."payload" ->> 'inspirationRevisionId') NOT BETWEEN 1 AND 64
      OR jsonb_typeof(NEW."payload" -> 'inspirationId') IS DISTINCT FROM 'string'
      OR length(NEW."payload" ->> 'inspirationId') NOT BETWEEN 1 AND 64
      OR NEW."payload" ->> 'source' NOT IN ('PLATFORM_LOOK', 'BOOKED_PRO_LOOK', 'EXTERNAL_UPLOAD')
      OR NEW."payload" ->> 'inspirationRevisionId' IS DISTINCT FROM (
        SELECT latest."id"
        FROM public."ConsultRevision" AS latest
        WHERE latest."consultSessionId" = NEW."consultSessionId"
          AND latest."kind" = 'INSPIRATION'
        ORDER BY latest."revision" DESC
        LIMIT 1
      )
      OR NOT public."consult_inspiration_attributes_valid"(NEW."payload" -> 'attributes')
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

  -- ── The v3 arm: the read stage's own shape ───────────────────────────────
  IF session_status NOT IN ('MEDIA_READY', 'ANALYZING')
    OR NEW."schemaVersion" <> 3
    OR NEW."promptVersion" IS DISTINCT FROM 'inspiration-hair-color-v2'
    OR NEW."model" IS NULL
    OR btrim(NEW."model") <> NEW."model"
    OR length(NEW."model") NOT BETWEEN 1 AND 128
    OR jsonb_typeof(NEW."payload") IS DISTINCT FROM 'object'
    OR NOT NEW."payload" ?& ARRAY[
      'schemaVersion', 'inspirationId', 'source', 'attributes'
    ]
    OR NEW."payload" - ARRAY[
      'schemaVersion', 'inspirationId', 'source', 'attributes'
    ] <> '{}'::jsonb
    OR NEW."payload" -> 'schemaVersion' <> '3'::jsonb
    OR jsonb_typeof(NEW."payload" -> 'inspirationId') IS DISTINCT FROM 'string'
    OR length(NEW."payload" ->> 'inspirationId') NOT BETWEEN 1 AND 64
    OR NEW."payload" ->> 'source' NOT IN ('PLATFORM_LOOK', 'BOOKED_PRO_LOOK', 'EXTERNAL_UPLOAD')
    -- The artefact is pinned to the inspiration ROW it read, which must be the
    -- ATTACHED reference on THIS consult, and whose own source must match what
    -- the artefact claims to have read. A reading of some other consult's
    -- photograph, or of a replaced one, never reaches the table.
    OR NOT EXISTS (
      SELECT 1
      FROM public."ConsultInspiration" AS attached
      WHERE attached."id" = NEW."payload" ->> 'inspirationId'
        AND attached."consultSessionId" = NEW."consultSessionId"
        AND attached."status" = 'ATTACHED'
        AND attached."source"::text = NEW."payload" ->> 'source'
    )
    OR NOT public."consult_inspiration_attributes_valid"(NEW."payload" -> 'attributes')
    -- No C3 object material, no provider dumps, and none of the person in the
    -- photograph — this artefact is about hair colour and holds no free text.
    OR NEW."payload"::text ~* '"(base64|bytes|signedUrl|token|storagePath|storageBucket|rawPath|providerRequest|providerResponse|hiddenReasoning|identity|ethnicity|health)"[[:space:]]*:'
  THEN
    RAISE EXCEPTION 'invalid versioned inspiration analysis payload'
      USING ERRCODE = '23514';
  END IF;

  -- The one relationship the level scale forbids, mirroring the analysis guard
  -- and consultHairLevelPairIsOrdered(). Either end UNKNOWN is unobserved.
  base_level := NEW."payload" #>> '{attributes,baseLevel,value}';
  lightest_level := NEW."payload" #>> '{attributes,lightestLevel,value}';
  IF base_level <> 'UNKNOWN' AND lightest_level <> 'UNKNOWN'
    AND split_part(base_level, '_', 2)::int > split_part(lightest_level, '_', 2)::int
  THEN
    RAISE EXCEPTION 'inspiration base level is lighter than its lightest level'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
ALTER FUNCTION "consult_inspiration_analysis_payload_guard"() SET search_path = '';
