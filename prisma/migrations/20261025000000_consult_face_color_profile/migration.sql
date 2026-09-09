-- C2-1: persist the richer Face & Color companion as a sibling artefact.
-- It is deliberately NOT a ConsultRevision kind: historical ANALYSIS/BRIEF
-- payloads stay byte-compatible, while this row is pinned 1:1 to one analysis.

ALTER TYPE "ConsultProviderCallKind"
  ADD VALUE 'ANALYSIS_FACE_COLOR' BEFORE 'ANALYSIS_DIRECTION';

CREATE TABLE "ConsultFaceColorProfile" (
  "id" TEXT NOT NULL,
  "consultSessionId" TEXT NOT NULL,
  "analysisRevisionId" TEXT NOT NULL,
  "schemaVersion" INTEGER NOT NULL,
  "promptVersion" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ConsultFaceColorProfile_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "ConsultFaceColorProfile"
  ADD CONSTRAINT "ConsultFaceColorProfile_consultSessionId_fkey"
  FOREIGN KEY ("consultSessionId") REFERENCES "ConsultSession"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ConsultFaceColorProfile"
  ADD CONSTRAINT "ConsultFaceColorProfile_analysisRevisionId_fkey"
  FOREIGN KEY ("analysisRevisionId") REFERENCES "ConsultRevision"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "ConsultFaceColorProfile_analysisRevisionId_key"
  ON "ConsultFaceColorProfile" ("analysisRevisionId");
CREATE INDEX "ConsultFaceColorProfile_consultSessionId_createdAt_idx"
  ON "ConsultFaceColorProfile" ("consultSessionId", "createdAt");

-- Deny every non-bypassing DB role; reads/writes go through server boundaries.
ALTER TABLE "ConsultFaceColorProfile" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "ConsultFaceColorProfile"
  ADD CONSTRAINT "ConsultFaceColorProfile_schema_version"
  CHECK (("schemaVersion" = 1) IS TRUE),
  ADD CONSTRAINT "ConsultFaceColorProfile_prompt_version"
  CHECK (("promptVersion" = 'face-color-companion-v1') IS TRUE),
  ADD CONSTRAINT "ConsultFaceColorProfile_model_shape"
  CHECK ((btrim("model") = "model" AND length("model") BETWEEN 1 AND 128) IS TRUE),
  ADD CONSTRAINT "ConsultFaceColorProfile_payload_shape"
  CHECK ((
    jsonb_typeof("payload") = 'object'
    AND "payload" ?& ARRAY[
      'skinDepth', 'surfaceOvertone', 'faceWidthBalance', 'chinContour',
      'eyeTilt', 'lidVisibility', 'browBoneRelationship',
      'browArchPosition', 'browTailDirection'
    ]
    AND "payload" - ARRAY[
      'skinDepth', 'surfaceOvertone', 'faceWidthBalance', 'chinContour',
      'eyeTilt', 'lidVisibility', 'browBoneRelationship',
      'browArchPosition', 'browTailDirection'
    ] = '{}'::jsonb
  ) IS TRUE);

ALTER TABLE "ConsultFaceColorProfile"
  ADD CONSTRAINT "ConsultFaceColorProfile_observations_valid"
  CHECK ((
    public."consult_analysis_observation_valid"(
      "payload" -> 'skinDepth', ARRAY['VERY_LIGHT','LIGHT','MEDIUM','DEEP','VERY_DEEP','UNKNOWN']
    )
    AND public."consult_analysis_observation_valid"(
      "payload" -> 'surfaceOvertone', ARRAY['BALANCED','VISIBLE_REDNESS','VISIBLE_GOLDEN_CAST','VISIBLE_OLIVE_CAST','UNKNOWN']
    )
    AND public."consult_analysis_observation_valid"(
      "payload" -> 'faceWidthBalance', ARRAY['FOREHEAD_DOMINANT','CHEEKBONE_DOMINANT','JAW_DOMINANT','BALANCED','UNKNOWN']
    )
    AND public."consult_analysis_observation_valid"(
      "payload" -> 'chinContour', ARRAY['SOFT','TAPERED','BROAD','ANGULAR','UNKNOWN']
    )
    AND public."consult_analysis_observation_valid"(
      "payload" -> 'eyeTilt', ARRAY['UPTURNED','LEVEL','DOWNTURNED','UNKNOWN']
    )
    AND public."consult_analysis_observation_valid"(
      "payload" -> 'lidVisibility', ARRAY['OPEN','PARTIAL','MINIMAL','DEEP_SET','PROMINENT','UNKNOWN']
    )
  ) IS TRUE);

ALTER TABLE "ConsultFaceColorProfile"
  ADD CONSTRAINT "ConsultFaceColorProfile_brow_observations_valid"
  CHECK ((
    public."consult_analysis_observation_valid"(
      "payload" -> 'browBoneRelationship', ARRAY['LOW','BALANCED','HIGH','UNKNOWN']
    )
    AND public."consult_analysis_observation_valid"(
      "payload" -> 'browArchPosition', ARRAY['INNER','CENTER','OUTER','STRAIGHT','UNKNOWN']
    )
    AND public."consult_analysis_observation_valid"(
      "payload" -> 'browTailDirection', ARRAY['LIFTED','LEVEL','DROPPED','UNKNOWN']
    )
  ) IS TRUE),
  ADD CONSTRAINT "ConsultFaceColorProfile_color_requires_face_view"
  CHECK ((
    ("payload" #> '{skinDepth,evidence}') <@ '["face_front","face_side"]'::jsonb
    AND ("payload" #> '{surfaceOvertone,evidence}') <@ '["face_front","face_side"]'::jsonb
  ) IS TRUE);

CREATE OR REPLACE FUNCTION public.consult_face_color_profile_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
DECLARE
  revision_kind public."ConsultRevisionKind";
  revision_session TEXT;
  observation JSONB;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'consult face/color profiles are immutable'
      USING ERRCODE = '23514';
  END IF;

  SELECT "kind", "consultSessionId"
    INTO revision_kind, revision_session
  FROM public."ConsultRevision"
  WHERE "id" = NEW."analysisRevisionId";

  IF revision_kind IS DISTINCT FROM 'ANALYSIS'
    OR revision_session IS DISTINCT FROM NEW."consultSessionId" THEN
    RAISE EXCEPTION 'face/color profile must pin the same consult analysis revision'
      USING ERRCODE = '23514';
  END IF;

  FOR observation IN SELECT value FROM jsonb_each(NEW."payload") LOOP
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(observation -> 'evidence') AS cited(key)
      WHERE key NOT IN ('early_photo', 'face_front', 'face_side', 'eyes_closeup')
    ) THEN
      RAISE EXCEPTION 'face/color profile requires face evidence'
        USING ERRCODE = '23514';
    END IF;
  END LOOP;

  RETURN NEW;
END;
$function$;

CREATE TRIGGER "consult_face_color_profile_guard"
BEFORE INSERT OR UPDATE ON "ConsultFaceColorProfile"
FOR EACH ROW EXECUTE FUNCTION public.consult_face_color_profile_guard();
