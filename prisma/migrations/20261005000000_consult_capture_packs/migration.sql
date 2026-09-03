-- Service-aware consult, slice 3: capture packs by service family
-- (Tori, 2026-09-03 — docs/product/CONSULT-SERVICE-AWARE-PLAN.md).
--
-- The hair pack ('hair-color-daylight' v2, seven shots) is unchanged. Two packs
-- join it (lib/consult/capture/registry.ts): 'face-daylight' v1 (the three
-- face views, existing keys) for skin, brows & lashes and makeup, and
-- 'area-daylight' v1 (area_wide, area_closeup, face_front) for nails, body and
-- any family nobody has modelled yet. Two shot keys are NEW wire values:
-- area_wide and area_closeup. One quality reason code joins the vocabulary:
-- SUBJECT_NOT_VISIBLE (the area pack's equivalent of HAIR_NOT_VISIBLE).
--
-- Every place the database enumerated the seven keys learns the union:
--   1. ConsultCapture_shape and UploadSession_consult_shape CHECKs — a pack
--      version 1 or 2 row may carry any registered key (the packs share a
--      version space, and the application checks the pair against the pack
--      it serves; the CHECK keeps the vocabulary and the structural rules).
--   2. ConsultCapture_quality_contract — the new reason code.
--   3. consult_analysis_evidence_valid / consult_direction_evidence_valid —
--      the analysis may cite an area view.
--   4. consult_revision_requires_agreements — the analysis prerequisite counts
--      accepted captures under any registered key and pack version.
--
-- All loosening: the deployed hair-only code keeps writing what it writes.

-- 1) Shape CHECKs -------------------------------------------------------------

ALTER TABLE "ConsultCapture"
  DROP CONSTRAINT "ConsultCapture_shape";
ALTER TABLE "ConsultCapture"
  ADD CONSTRAINT "ConsultCapture_shape" CHECK (
    "shotPackVersion" BETWEEN 1 AND 2
    AND "shotKey" IN (
      'hair_back', 'hair_left', 'hair_right', 'hair_crown',
      'face_front', 'face_side', 'eyes_closeup',
      'area_wide', 'area_closeup'
    )
    AND "schemaVersion" = 1
    AND "contentType" IN ('image/jpeg', 'image/png', 'image/webp')
    AND "sizeBytes" BETWEEN 1 AND 5000000
    AND ("checksumSha256" IS NULL OR "checksumSha256" ~ '^[0-9a-f]{64}$')
    AND length(btrim("attachIdempotencyKey")) BETWEEN 1 AND 128
    AND "attachIdempotencyKey" = btrim("attachIdempotencyKey")
    AND "attachRequestHash" ~ '^[0-9a-f]{64}$'
    AND (
      ("purgedAt" IS NULL AND "storageBucket" = 'media-private' AND "storagePath" IS NOT NULL)
      OR
      ("purgedAt" IS NOT NULL AND "storageBucket" IS NULL AND "storagePath" IS NULL)
    )
    AND (
      ("status" = 'ATTACHED'
        AND "qualityReasonCode" IS NULL
        AND "retakeTip" IS NULL
        AND "qualitySchemaVersion" IS NULL
        AND "qualityPromptVersion" IS NULL
        AND "qualityModel" IS NULL
        AND "qualityCheckedAt" IS NULL
        AND "qualityIdempotencyKey" IS NULL
        AND "qualityRequestHash" IS NULL)
      OR
      ("status" IN ('ACCEPTED', 'REJECTED')
        AND "qualityReasonCode" IS NOT NULL
        AND "qualitySchemaVersion" = 1
        AND "qualityPromptVersion" IS NOT NULL
        AND "qualityModel" IS NOT NULL
        AND "qualityCheckedAt" IS NOT NULL
        AND length(btrim("qualityIdempotencyKey")) BETWEEN 1 AND 128
        AND "qualityIdempotencyKey" = btrim("qualityIdempotencyKey")
        AND "qualityRequestHash" ~ '^[0-9a-f]{64}$')
    )
    AND ("retakeTip" IS NULL OR length(btrim("retakeTip")) BETWEEN 1 AND 160)
    AND ("purgeRequestedAt" IS NULL OR "purgeEligibleAt" IS NOT NULL)
  );

-- The upload-session CHECK, re-issued in full (current definition =
-- 20260925000000); only the shot-key / pack-version clause changes.
ALTER TABLE "UploadSession"
  DROP CONSTRAINT "UploadSession_consult_shape";
ALTER TABLE "UploadSession"
  ADD CONSTRAINT "UploadSession_consult_shape" CHECK (
    (
      "surface" <> 'CLIENT_CONSULT'
      AND "consultSessionId" IS NULL
      AND "serviceCategoryId" IS NULL
      AND "consultShotKey" IS NULL
      AND "shotPackVersion" IS NULL
      AND "captureSchemaVersion" IS NULL
      AND "idempotencyKey" IS NULL
      AND "requestHash" IS NULL
      AND "rawExpiresAt" IS NULL
      AND "purgeEligibleAt" IS NULL
      AND "purgedAt" IS NULL
    ) OR (
      "surface" = 'CLIENT_CONSULT'
      AND "consultSessionId" IS NOT NULL
      AND "clientId" IS NOT NULL
      AND "professionalId" IS NOT NULL
      AND "serviceCategoryId" IS NOT NULL
      AND "shotPackVersion" BETWEEN 1 AND 2
      AND "consultShotKey" IN (
        'hair_back', 'hair_left', 'hair_right', 'hair_crown',
        'face_front', 'face_side', 'eyes_closeup',
        'area_wide', 'area_closeup'
      )
      AND "captureSchemaVersion" = 1
      AND length(btrim("idempotencyKey")) BETWEEN 1 AND 128
      AND "idempotencyKey" = btrim("idempotencyKey")
      AND "requestHash" ~ '^[0-9a-f]{64}$'
      AND "rawExpiresAt" > "expiresAt"
      AND "rawExpiresAt" <= "createdAt" + INTERVAL '24 hours'
      AND "contentType" IN ('image/jpeg', 'image/png', 'image/webp')
      AND "maxBytes" BETWEEN 1 AND 5000000
      AND ("checksumSha256" IS NULL OR "checksumSha256" ~ '^[0-9a-f]{64}$')
      AND (
        ("purgedAt" IS NULL AND "storageBucket" = 'media-private'
          AND "storagePath" ~ '^consult-raw/v1/[0-9a-f-]{36}\.(jpg|png|webp)$')
        OR
        ("purgedAt" IS NOT NULL AND "storageBucket" = 'purged'
          AND "storagePath" = 'purged/' || "id")
      )
    )
  );

-- 2) Quality reason codes -----------------------------------------------------

ALTER TABLE "ConsultCapture"
  DROP CONSTRAINT "ConsultCapture_quality_contract";
ALTER TABLE "ConsultCapture"
  ADD CONSTRAINT "ConsultCapture_quality_contract" CHECK (
    "status" = 'ATTACHED'
    OR (
      "qualityPromptVersion" IN ('hair-color-capture-v1', 'full-analysis-capture-v2')
      AND "qualitySchemaVersion" = 1
      AND (
        ("status" = 'ACCEPTED' AND "qualityReasonCode" = 'PASS' AND "retakeTip" IS NULL)
        OR
        ("status" = 'REJECTED' AND "qualityReasonCode" IN (
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

-- 3) Evidence vocabularies ----------------------------------------------------

CREATE OR REPLACE FUNCTION "consult_analysis_evidence_valid"(value JSONB)
RETURNS BOOLEAN AS $$
  SELECT jsonb_typeof(value) = 'array'
    AND jsonb_array_length(value) <= 7
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(value) AS evidence
      WHERE jsonb_typeof(evidence) <> 'string'
        OR evidence #>> '{}' NOT IN (
          'hair_back', 'hair_left', 'hair_right', 'hair_crown',
          'face_front', 'face_side', 'eyes_closeup',
          'area_wide', 'area_closeup'
        )
    )
    AND (
      SELECT count(*) = count(DISTINCT evidence #>> '{}')
      FROM jsonb_array_elements(value) AS evidence
    );
$$ LANGUAGE sql IMMUTABLE;
ALTER FUNCTION "consult_analysis_evidence_valid"(JSONB) SET search_path = '';

CREATE OR REPLACE FUNCTION "consult_direction_evidence_valid"(value JSONB)
RETURNS BOOLEAN AS $$
  SELECT jsonb_typeof(value) = 'array'
    AND jsonb_array_length(value) BETWEEN 1 AND 8
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(value) AS evidence
      WHERE jsonb_typeof(evidence) <> 'string'
        OR evidence #>> '{}' NOT IN (
          'hair_back', 'hair_left', 'hair_right', 'hair_crown',
          'face_front', 'face_side', 'eyes_closeup',
          'area_wide', 'area_closeup', 'intake'
        )
    )
    AND (
      SELECT count(*) = count(DISTINCT evidence #>> '{}')
      FROM jsonb_array_elements(value) AS evidence
    );
$$ LANGUAGE sql IMMUTABLE;
ALTER FUNCTION "consult_direction_evidence_valid"(JSONB) SET search_path = '';

-- 4) Analysis prerequisite: accepted captures under any registered key ------

DO $$
DECLARE
  definition TEXT;
  updated TEXT;
BEGIN
  SELECT pg_get_functiondef('public.consult_revision_requires_agreements()'::regprocedure)
    INTO definition;

  updated := replace(
    definition,
    'capture."shotKey" IN (''hair_back'', ''hair_left'', ''hair_right'', ''hair_crown'', ''face_front'', ''face_side'', ''eyes_closeup'')',
    'capture."shotKey" IN (''hair_back'', ''hair_left'', ''hair_right'', ''hair_crown'', ''face_front'', ''face_side'', ''eyes_closeup'', ''area_wide'', ''area_closeup'')'
  );
  IF position('area_closeup' in updated) = 0 THEN
    RAISE EXCEPTION 'expected analysis prerequisite shot-key pin not found';
  END IF;

  updated := replace(
    updated,
    'capture."shotPackVersion" = 2',
    'capture."shotPackVersion" BETWEEN 1 AND 2'
  );
  IF position('capture."shotPackVersion" BETWEEN 1 AND 2' in updated) = 0 THEN
    RAISE EXCEPTION 'expected analysis prerequisite pack-version pin not found';
  END IF;

  EXECUTE updated;
END;
$$;
ALTER FUNCTION "consult_revision_requires_agreements"() SET search_path = '';
