-- P4a: inspiration analysis schema v2 / prompt `inspiration-hair-color-v2`.
--
-- The reference read reports `baseLevel` and `lightestLevel` where v1 reported
-- one `level`. v1's prompt asked for "the depth of the LIGHTEST dominant
-- colour", so the half it threw away — where the colour starts — is exactly
-- the half a colourist needs to plan the service, and it could not be lined up
-- against the client's own hair, whose read had a different shape again. Both
-- artefacts now speak the one scale (lib/consult/hairLevel.ts).
--
-- 🔴 `consult_inspiration_analysis_payload_guard` pins BOTH the schema version
-- and the prompt version. Same trap as every other consult version bump: move
-- the TypeScript constant alone and the insert raises
--   23514 "invalid versioned inspiration analysis payload"
-- after the paid vision call has already been made.
--
-- Swept against the live definitions in a fully-migrated database (the local
-- tovis_test, 2026-09-04), not reconstructed from the migration files:
--   SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public' AND p.prokind = 'f'
--      AND pg_get_functiondef(p.oid) LIKE '%inspiration-hair-color-%';
--   -- consult_inspiration_analysis_payload_guard, and nothing else
--   SELECT conname FROM pg_constraint
--    WHERE pg_get_constraintdef(oid) LIKE '%inspiration-hair-color-%';
--   -- no rows
-- and '%attributes,level%' named the same guard alone.
--
-- Re-issued in full (current definition = 20261007000001, which introduced it
-- one day ago and has not been patched since).
--
-- Forward-only, and safe: the INSPIRATION_ANALYSIS kind was created yesterday
-- and production has never run a consult past it, so no v1 artefact exists to
-- invalidate. A client mid-consult is refused at the contract, not here.

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

  IF session_status <> 'ANALYZING'
    OR NEW."schemaVersion" <> 2
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
    -- The artefact is pinned to the CURRENT guided-inspiration revision. A
    -- stale pin is not a display problem, it is the wrong photograph's colour
    -- attached to this consult, so it never reaches the table.
    OR NEW."payload" ->> 'inspirationRevisionId' IS DISTINCT FROM (
      SELECT latest."id"
      FROM public."ConsultRevision" AS latest
      WHERE latest."consultSessionId" = NEW."consultSessionId"
        AND latest."kind" = 'INSPIRATION'
      ORDER BY latest."revision" DESC
      LIMIT 1
    )
    OR jsonb_typeof(NEW."payload" -> 'attributes') IS DISTINCT FROM 'object'
    OR NOT (NEW."payload" -> 'attributes') ?& ARRAY[
      'baseLevel', 'lightestLevel', 'tone', 'technique', 'placement',
      'rootBlend', 'finish', 'dimension'
    ]
    OR (NEW."payload" -> 'attributes') - ARRAY[
      'baseLevel', 'lightestLevel', 'tone', 'technique', 'placement',
      'rootBlend', 'finish', 'dimension'
    ] <> '{}'::jsonb
    OR NOT public."consult_inspiration_observation_valid"(
      NEW."payload" #> '{attributes,baseLevel}',
      ARRAY[
        'LEVEL_1', 'LEVEL_2', 'LEVEL_3', 'LEVEL_4', 'LEVEL_5',
        'LEVEL_6', 'LEVEL_7', 'LEVEL_8', 'LEVEL_9', 'LEVEL_10', 'UNKNOWN'
      ]
    )
    OR NOT public."consult_inspiration_observation_valid"(
      NEW."payload" #> '{attributes,lightestLevel}',
      ARRAY[
        'LEVEL_1', 'LEVEL_2', 'LEVEL_3', 'LEVEL_4', 'LEVEL_5',
        'LEVEL_6', 'LEVEL_7', 'LEVEL_8', 'LEVEL_9', 'LEVEL_10', 'UNKNOWN'
      ]
    )
    OR NOT public."consult_inspiration_observation_valid"(
      NEW."payload" #> '{attributes,tone}',
      ARRAY['WARM', 'COOL', 'NEUTRAL', 'UNKNOWN']
    )
    OR NOT public."consult_inspiration_observation_valid"(
      NEW."payload" #> '{attributes,technique}',
      ARRAY[
        'SINGLE_PROCESS', 'BALAYAGE', 'FOIL_HIGHLIGHTS', 'BABYLIGHTS',
        'LOWLIGHTS', 'COLOR_MELT', 'GLOSS_ONLY', 'DOUBLE_PROCESS',
        'NATURAL_UNCOLORED', 'UNKNOWN'
      ]
    )
    OR NOT public."consult_inspiration_observation_valid"(
      NEW."payload" #> '{attributes,placement}',
      ARRAY[
        'ALL_OVER', 'FACE_FRAMING', 'MIDS_TO_ENDS', 'ENDS_ONLY',
        'SURFACE_ONLY', 'UNDERNEATH', 'PANELS', 'UNKNOWN'
      ]
    )
    OR NOT public."consult_inspiration_observation_valid"(
      NEW."payload" #> '{attributes,rootBlend}',
      ARRAY['SOLID_TO_ROOT', 'SHADOW_ROOT', 'SEAMLESS_MELT', 'GROWN_OUT', 'UNKNOWN']
    )
    OR NOT public."consult_inspiration_observation_valid"(
      NEW."payload" #> '{attributes,finish}',
      ARRAY['HIGH_SHINE', 'SATIN', 'MATTE', 'UNKNOWN']
    )
    OR NOT public."consult_inspiration_observation_valid"(
      NEW."payload" #> '{attributes,dimension}',
      ARRAY['FLAT', 'SUBTLE', 'MEDIUM', 'HIGH_CONTRAST', 'UNKNOWN']
    )
    -- Part 0 rule 4: an all-UNKNOWN artefact is an unreadable photo, not a
    -- low-confidence answer. It never becomes a stored success.
    OR NOT EXISTS (
      SELECT 1
      FROM jsonb_each(NEW."payload" -> 'attributes') AS attribute(key, value)
      WHERE attribute.value ->> 'value' <> 'UNKNOWN'
    )
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
