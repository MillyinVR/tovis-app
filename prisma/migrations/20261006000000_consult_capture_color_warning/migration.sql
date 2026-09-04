-- Consult capture: the colour-cast rejection becomes shot-aware (bug B3,
-- docs/consult/tovis-ai-consult-handoff.md Part 1).
--
-- A warm-light / colour-cast finding still REJECTS a full view — colour
-- fidelity is the point of those photos. On a TIGHT_CROP view (the shot's own
-- spec asks the subject to fill the frame: eyes_closeup, area_closeup) there
-- is almost no background left to read the light off, so the frame's average
-- colour is mostly skin and a warm reading is as likely to be the person as
-- the room. Rejecting there refused perfectly usable close-ups. The finding is
-- now recorded as a WARNING on the ACCEPTED row instead.
--
-- Four changes, all additive/loosening; deployed code keeps writing what it
-- writes (a NULL warning column, prompt version v2):
--   1. "qualityWarningCode" — a new nullable column.
--   2. ConsultCapture_quality_contract — learns the new prompt version
--      ('full-analysis-capture-v3') and constrains the new column: it may only
--      be a colour code, and only on an ACCEPTED row.
--   3. consult_revision_requires_agreements — the analysis prerequisite pins
--      the prompt version, so the bump alone would make every accepted photo
--      invisible to it and the analysis would raise. The pin becomes a set.
--   4. consult_capture_guard — the immutability list must cover the new
--      evidence column or a finalized quality decision could be rewritten.

-- 1) The column ---------------------------------------------------------------

ALTER TABLE "ConsultCapture"
  ADD COLUMN "qualityWarningCode" VARCHAR(64);

-- 2) Quality contract ---------------------------------------------------------

ALTER TABLE "ConsultCapture"
  DROP CONSTRAINT "ConsultCapture_quality_contract";
ALTER TABLE "ConsultCapture"
  ADD CONSTRAINT "ConsultCapture_quality_contract" CHECK (
    ("status" = 'ATTACHED' AND "qualityWarningCode" IS NULL)
    OR (
      "qualityPromptVersion" IN (
        'hair-color-capture-v1',
        'full-analysis-capture-v2',
        'full-analysis-capture-v3'
      )
      AND "qualitySchemaVersion" = 1
      AND (
        ("status" = 'ACCEPTED' AND "qualityReasonCode" = 'PASS' AND "retakeTip" IS NULL
          AND ("qualityWarningCode" IS NULL
            OR "qualityWarningCode" IN ('WARM_INDOOR_LIGHT', 'COLOR_CAST')))
        OR
        ("status" = 'REJECTED' AND "qualityWarningCode" IS NULL
          AND "qualityReasonCode" IN (
          'WARM_INDOOR_LIGHT',
          'COLOR_CAST',
          'VIEW_MISMATCH',
          'HAIR_NOT_VISIBLE',
          'SUBJECT_NOT_VISIBLE',
          'BLURRY',
          'TOO_DARK',
          'TOO_BRIGHT',
          'OTHER_QUALITY_FAILURE'
        ))
      )
    )
  );

-- 3) The analysis prerequisite ------------------------------------------------
-- `consult_revision_requires_agreements` pins the prompt version an accepted
-- capture must carry, so bumping the constant alone makes EVERY accepted photo
-- invisible to it and the analysis raises instead of running. The pin becomes a
-- set of two: the bump only loosened a colour rule, so a capture judged under
-- the stricter v2 is still a good input, and a client who accepted photos
-- before the deploy and presses Analyze after it is not stranded. Same
-- pg_get_functiondef rewrite the earlier slices used, with the same assertion
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
    'capture."qualityPromptVersion" = ''full-analysis-capture-v2''',
    'capture."qualityPromptVersion" IN (''full-analysis-capture-v2'', ''full-analysis-capture-v3'')'
  );
  IF position('full-analysis-capture-v3' in updated) = 0 THEN
    RAISE EXCEPTION 'expected analysis prerequisite prompt-version pin not found';
  END IF;

  EXECUTE updated;
END;
$$;
ALTER FUNCTION "consult_revision_requires_agreements"() SET search_path = '';

-- 4) Immutability -------------------------------------------------------------
-- Re-issued in full (current definition = 20260907000001, copied verbatim);
-- the only change is the new column joining the quality-evidence
-- immutability list, so a finalized decision cannot be quietly rewritten.

CREATE OR REPLACE FUNCTION "consult_capture_guard"()
RETURNS TRIGGER AS $$
DECLARE
  binding_matches BOOLEAN;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT
      upload."surface" = 'CLIENT_CONSULT'
      AND upload."status" = 'PENDING'
      AND upload."consultSessionId" = NEW."consultSessionId"
      AND upload."consultShotKey" = NEW."shotKey"
      AND upload."shotPackVersion" = NEW."shotPackVersion"
      AND upload."captureSchemaVersion" = NEW."schemaVersion"
      AND upload."storageBucket" = NEW."storageBucket"
      AND upload."storagePath" = NEW."storagePath"
      AND upload."contentType" = NEW."contentType"
      AND upload."rawExpiresAt" = NEW."rawExpiresAt"
      AND session."status" = 'MEDIA_READY'
    INTO binding_matches
    FROM public."UploadSession" AS upload
    JOIN public."ConsultSession" AS session ON session."id" = NEW."consultSessionId"
    WHERE upload."id" = NEW."uploadSessionId";

    IF binding_matches IS DISTINCT FROM TRUE
      OR NOT public."consult_current_agreements_active"(NEW."consultSessionId")
    THEN
      RAISE EXCEPTION 'capture must match an active server-minted consult upload'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW."id" <> OLD."id"
    OR NEW."consultSessionId" <> OLD."consultSessionId"
    OR NEW."uploadSessionId" <> OLD."uploadSessionId"
    OR NEW."shotKey" <> OLD."shotKey"
    OR NEW."shotPackVersion" <> OLD."shotPackVersion"
    OR NEW."schemaVersion" <> OLD."schemaVersion"
    OR NEW."contentType" <> OLD."contentType"
    OR NEW."sizeBytes" <> OLD."sizeBytes"
    OR NEW."checksumSha256" IS DISTINCT FROM OLD."checksumSha256"
    OR NEW."attachIdempotencyKey" <> OLD."attachIdempotencyKey"
    OR NEW."attachRequestHash" <> OLD."attachRequestHash"
    OR NEW."rawExpiresAt" <> OLD."rawExpiresAt"
  THEN
    RAISE EXCEPTION 'capture binding is immutable' USING ERRCODE = '23514';
  END IF;

  IF OLD."status" <> 'ATTACHED' AND NEW."status" <> OLD."status" THEN
    RAISE EXCEPTION 'capture quality decision is immutable' USING ERRCODE = '23514';
  END IF;
  IF OLD."qualityCheckedAt" IS NOT NULL AND (
    NEW."qualityReasonCode" IS DISTINCT FROM OLD."qualityReasonCode"
    OR NEW."qualityWarningCode" IS DISTINCT FROM OLD."qualityWarningCode"
    OR NEW."retakeTip" IS DISTINCT FROM OLD."retakeTip"
    OR NEW."qualitySchemaVersion" IS DISTINCT FROM OLD."qualitySchemaVersion"
    OR NEW."qualityPromptVersion" IS DISTINCT FROM OLD."qualityPromptVersion"
    OR NEW."qualityModel" IS DISTINCT FROM OLD."qualityModel"
    OR NEW."qualityCheckedAt" IS DISTINCT FROM OLD."qualityCheckedAt"
    OR NEW."qualityIdempotencyKey" IS DISTINCT FROM OLD."qualityIdempotencyKey"
    OR NEW."qualityRequestHash" IS DISTINCT FROM OLD."qualityRequestHash"
  ) THEN
    RAISE EXCEPTION 'capture quality evidence is immutable' USING ERRCODE = '23514';
  END IF;
  IF OLD."purgedAt" IS NOT NULL AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'purged capture evidence is immutable' USING ERRCODE = '23514';
  END IF;
  IF OLD."status" = 'ATTACHED' AND NEW."status" IN ('ACCEPTED', 'REJECTED')
    AND NOT public."consult_current_agreements_active"(NEW."consultSessionId")
  THEN
    RAISE EXCEPTION 'current prerequisites are required to finalize capture quality'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
ALTER FUNCTION "consult_capture_guard"() SET search_path = '';
