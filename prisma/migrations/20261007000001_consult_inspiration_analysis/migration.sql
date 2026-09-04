-- P4, slice 2 of 2: the INSPIRATION_ANALYSIS revision becomes a first-class
-- artefact, with the same guard set every other consult revision kind carries.
--
-- A new ConsultRevisionKind is NOT free. Three things already in the database
-- have an opinion about the kinds that exist, and two of them would have been
-- silently wrong:
--
--   1. ConsultRevision_idempotency_shape — a CHECK that enumerates the kinds.
--      Its keyed arm lists INTAKE/INSPIRATION/ANALYSIS and its unkeyed arm is
--      BRIEF, so a fourth kind satisfies NEITHER arm and every insert would
--      have failed the CHECK. (This is the analogue of the prompt-version pin
--      that the colour-warning slice found in 20261006000000.)
--   2. consult_revision_requires_agreements — pins INTAKE, INSPIRATION and
--      ANALYSIS each to the lifecycle states they may be written in. A kind
--      it has never heard of falls through every pin and would be writable in
--      ANY non-terminal state. The new kind is pinned to ANALYZING, the only
--      state it is ever produced in.
--   3. The per-kind payload guards (analysis / inspiration / intake / brief)
--      all early-return on a kind that is not theirs, so they need no change —
--      but that also means the new kind arrives with NO payload contract at
--      all until one is written. Section 3 writes it.
--
-- Verified against the live definitions with pg_get_functiondef on the test
-- database (2026-09-04) rather than reconstructed from the migration chain.

-- 1) The idempotency-shape CHECK --------------------------------------------
-- Re-issued in full (current definition = 20260913000001). The only change is
-- INSPIRATION_ANALYSIS joining the keyed arm: the artefact is written under a
-- caller-derived key and its own request hash, exactly like the analysis.

ALTER TABLE "ConsultRevision"
  DROP CONSTRAINT "ConsultRevision_idempotency_shape";
ALTER TABLE "ConsultRevision"
  ADD CONSTRAINT "ConsultRevision_idempotency_shape" CHECK (
    (
      "kind" = 'BRIEF'
      AND "idempotencyKey" IS NULL
      AND "requestHash" IS NULL
    )
    OR
    (
      "kind" IN ('INTAKE', 'INSPIRATION', 'INSPIRATION_ANALYSIS', 'ANALYSIS')
      AND "idempotencyKey" IS NOT NULL
      AND "requestHash" IS NOT NULL
      AND btrim("idempotencyKey") = "idempotencyKey"
      AND length(btrim("idempotencyKey")) BETWEEN 1 AND 128
      AND "requestHash" ~ '^[0-9a-f]{64}$'
    )
  );

-- 2) The lifecycle pin -------------------------------------------------------
-- Same pg_get_functiondef rewrite the earlier consult slices use, with the
-- same assertion so a drifted definition fails loudly instead of silently not
-- applying.

DO $$
DECLARE
  definition TEXT;
  updated TEXT;
BEGIN
  SELECT pg_get_functiondef('public.consult_revision_requires_agreements()'::regprocedure)
    INTO definition;

  updated := replace(
    definition,
    'IF NEW."kind" = ''ANALYSIS'' AND session_status <> ''ANALYZING'' THEN',
    'IF NEW."kind" = ''INSPIRATION_ANALYSIS'' AND session_status <> ''ANALYZING'' THEN RAISE EXCEPTION ''consult lifecycle does not permit inspiration analysis revision in state %'', session_status USING ERRCODE = ''23514''; END IF; IF NEW."kind" = ''ANALYSIS'' AND session_status <> ''ANALYZING'' THEN'
  );
  IF position('inspiration analysis revision in state' in updated) = 0 THEN
    RAISE EXCEPTION 'expected analysis lifecycle pin not found';
  END IF;

  EXECUTE updated;
END;
$$;
ALTER FUNCTION "consult_revision_requires_agreements"() SET search_path = '';

-- 3) The payload contract ----------------------------------------------------
-- One observation validator for the inspiration shape. It is NOT
-- consult_analysis_observation_valid: that one requires exactly three keys and
-- knows nothing about a region, and widening it would loosen the analysis
-- contract to buy nothing.

CREATE OR REPLACE FUNCTION "consult_inspiration_region_valid"(value JSONB)
RETURNS BOOLEAN AS $$
  SELECT value = 'null'::jsonb
    OR (
      jsonb_typeof(value) = 'object'
      AND value ?& ARRAY['x', 'y', 'w', 'h']
      AND value - ARRAY['x', 'y', 'w', 'h'] = '{}'::jsonb
      AND jsonb_typeof(value -> 'x') = 'number'
      AND jsonb_typeof(value -> 'y') = 'number'
      AND jsonb_typeof(value -> 'w') = 'number'
      AND jsonb_typeof(value -> 'h') = 'number'
      AND (value ->> 'x')::numeric >= 0
      AND (value ->> 'y')::numeric >= 0
      AND (value ->> 'w')::numeric > 0
      AND (value ->> 'h')::numeric > 0
      AND (value ->> 'x')::numeric + (value ->> 'w')::numeric <= 1
      AND (value ->> 'y')::numeric + (value ->> 'h')::numeric <= 1
    );
$$ LANGUAGE sql IMMUTABLE;
ALTER FUNCTION "consult_inspiration_region_valid"(JSONB) SET search_path = '';

CREATE OR REPLACE FUNCTION "consult_inspiration_observation_valid"(
  value JSONB,
  allowed_values TEXT[]
)
RETURNS BOOLEAN AS $$
  SELECT jsonb_typeof(value) = 'object'
    AND value ?& ARRAY['value', 'confidence', 'evidence', 'region']
    AND value - ARRAY['value', 'confidence', 'evidence', 'region'] = '{}'::jsonb
    AND value ->> 'value' = ANY(allowed_values)
    AND public."consult_analysis_confidence_valid"(value -> 'confidence')
    AND jsonb_typeof(value -> 'evidence') = 'array'
    AND jsonb_array_length(value -> 'evidence') <= 1
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(value -> 'evidence') AS label(name)
      WHERE label.name <> 'inspiration'
    )
    AND public."consult_inspiration_region_valid"(value -> 'region')
    AND (
      -- An UNKNOWN cites nothing, claims almost nothing, and points nowhere;
      -- a reading must do all three. Same rule as the TypeScript sanitizer, so
      -- a direct SQL writer cannot store what the app would have refused.
      (
        value ->> 'value' = 'UNKNOWN'
        AND jsonb_array_length(value -> 'evidence') = 0
        AND value -> 'region' = 'null'::jsonb
        AND (value #>> '{confidence,max}')::numeric <= 0.35
      )
      OR
      (
        value ->> 'value' <> 'UNKNOWN'
        AND jsonb_array_length(value -> 'evidence') = 1
        AND value -> 'region' <> 'null'::jsonb
      )
    );
$$ LANGUAGE sql IMMUTABLE;
ALTER FUNCTION "consult_inspiration_observation_valid"(JSONB, TEXT[]) SET search_path = '';

CREATE OR REPLACE FUNCTION "consult_inspiration_analysis_payload_guard"()
RETURNS TRIGGER AS $$
DECLARE
  session_status public."ConsultSessionStatus";
BEGIN
  IF NEW."kind" <> 'INSPIRATION_ANALYSIS' THEN
    RETURN NEW;
  END IF;

  SELECT "status" INTO session_status
  FROM public."ConsultSession"
  WHERE "id" = NEW."consultSessionId";

  IF session_status <> 'ANALYZING'
    OR NEW."schemaVersion" <> 1
    OR NEW."promptVersion" IS DISTINCT FROM 'inspiration-hair-color-v1'
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
    OR NEW."payload" -> 'schemaVersion' <> '1'::jsonb
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
      'level', 'tone', 'technique', 'placement', 'rootBlend', 'finish', 'dimension'
    ]
    OR (NEW."payload" -> 'attributes') - ARRAY[
      'level', 'tone', 'technique', 'placement', 'rootBlend', 'finish', 'dimension'
    ] <> '{}'::jsonb
    OR NOT public."consult_inspiration_observation_valid"(
      NEW."payload" #> '{attributes,level}',
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

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
ALTER FUNCTION "consult_inspiration_analysis_payload_guard"() SET search_path = '';

CREATE TRIGGER "ConsultRevision_inspiration_analysis_payload_guard"
  BEFORE INSERT ON "ConsultRevision"
  FOR EACH ROW EXECUTE FUNCTION "consult_inspiration_analysis_payload_guard"();

-- 4) Content-free audit evidence, like every other kind ----------------------

CREATE OR REPLACE FUNCTION "consult_inspiration_analysis_revision_requires_audit"()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."kind" = 'INSPIRATION_ANALYSIS' AND NOT EXISTS (
    SELECT 1 FROM public."ConsultAuditEvent"
    WHERE "revisionId" = NEW."id"
      AND "consultSessionId" = NEW."consultSessionId"
      AND "action" = 'REVISION_CREATED'
  ) THEN
    RAISE EXCEPTION 'inspiration analysis revision requires content-free audit evidence'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
ALTER FUNCTION "consult_inspiration_analysis_revision_requires_audit"() SET search_path = '';

CREATE CONSTRAINT TRIGGER "ConsultRevision_inspiration_analysis_requires_audit"
  AFTER INSERT ON "ConsultRevision"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "consult_inspiration_analysis_revision_requires_audit"();
