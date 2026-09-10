-- Additive sibling; historical ANALYSIS/BRIEF JSON and API contracts unchanged.
ALTER TYPE "ConsultProviderCallKind" ADD VALUE 'ANALYSIS_SUITABILITY';

CREATE TABLE "ConsultSuitabilityTranslation" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "consultSessionId" TEXT NOT NULL REFERENCES "ConsultSession"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "analysisRevisionId" TEXT NOT NULL REFERENCES "ConsultRevision"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "clientRevisionId" TEXT NOT NULL REFERENCES "ConsultRevision"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "schemaVersion" INTEGER NOT NULL,
  "promptVersion" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ConsultSuitabilityTranslation_version" CHECK ((
    "schemaVersion" = 1 AND "promptVersion" = 'suitability-translation-v1'
    AND "payload" ->> 'schemaVersion' = '1'
    AND "payload" ->> 'promptVersion' = "promptVersion"
    AND "payload" ->> 'analysisRevisionId' = "analysisRevisionId"
    AND "payload" ->> 'clientRevisionId' = "clientRevisionId"
    AND "payload" -> 'requiresProfessionalReview' = 'true'::jsonb
    AND "payload" ->> 'clientSource' IN ('INSPIRATION', 'INTAKE')
  ) IS TRUE),
  CONSTRAINT "ConsultSuitabilityTranslation_model" CHECK ((btrim("model") = "model" AND length("model") BETWEEN 1 AND 128) IS TRUE),
  CONSTRAINT "ConsultSuitabilityTranslation_shape" CHECK ((
    jsonb_typeof("payload") = 'object'
    AND "payload" ?& ARRAY['schemaVersion','promptVersion','requiresProfessionalReview','analysisRevisionId','clientRevisionId','clientSource','whatYouLoved','tailoring','proConfirmations']
    AND "payload" - ARRAY['schemaVersion','promptVersion','requiresProfessionalReview','analysisRevisionId','clientRevisionId','clientSource','whatYouLoved','tailoring','proConfirmations'] = '{}'::jsonb
    AND jsonb_array_length("payload" -> 'whatYouLoved') BETWEEN 1 AND 30
    AND jsonb_array_length("payload" -> 'tailoring') BETWEEN 1 AND 3
    AND jsonb_array_length("payload" -> 'proConfirmations') BETWEEN 1 AND 4
  ) IS TRUE)
);
CREATE UNIQUE INDEX "ConsultSuitabilityTranslation_analysisRevisionId_key" ON "ConsultSuitabilityTranslation"("analysisRevisionId");
CREATE INDEX "ConsultSuitabilityTranslation_consultSessionId_createdAt_idx" ON "ConsultSuitabilityTranslation"("consultSessionId", "createdAt");
CREATE INDEX "ConsultSuitabilityTranslation_clientRevisionId_idx" ON "ConsultSuitabilityTranslation"("clientRevisionId");
ALTER TABLE "ConsultSuitabilityTranslation" ENABLE ROW LEVEL SECURITY;

CREATE FUNCTION public.consult_suitability_translation_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path TO '' AS $function$
DECLARE
  analysis_row public."ConsultRevision"%ROWTYPE;
  client_row public."ConsultRevision"%ROWTYPE;
  source JSONB;
  item JSONB;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'consult suitability translations are immutable' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO analysis_row FROM public."ConsultRevision" WHERE "id" = NEW."analysisRevisionId";
  SELECT * INTO client_row FROM public."ConsultRevision" WHERE "id" = NEW."clientRevisionId";
  IF analysis_row."kind" IS DISTINCT FROM 'ANALYSIS'
    OR analysis_row."consultSessionId" IS DISTINCT FROM NEW."consultSessionId"
    OR client_row."consultSessionId" IS DISTINCT FROM NEW."consultSessionId"
    OR client_row."kind"::text IS DISTINCT FROM NEW."payload" ->> 'clientSource'
    OR client_row."revision" >= analysis_row."revision" THEN
    RAISE EXCEPTION 'suitability must pin same-session analysis and preceding client revisions' USING ERRCODE = '23514';
  END IF;
  FOR item IN
    SELECT value FROM jsonb_array_elements(NEW."payload" -> 'tailoring')
    UNION ALL
    SELECT value FROM jsonb_array_elements(NEW."payload" -> 'proConfirmations')
  LOOP
    IF jsonb_typeof(item -> 'sources') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'suitability guidance requires source citations' USING ERRCODE = '23514';
    END IF;
    IF jsonb_array_length(item -> 'sources') < 1 THEN
      RAISE EXCEPTION 'suitability guidance requires source citations' USING ERRCODE = '23514';
    END IF;
  END LOOP;
  FOR source IN
    SELECT value FROM jsonb_array_elements(NEW."payload" -> 'whatYouLoved')
    UNION ALL
    SELECT s.value FROM jsonb_array_elements(NEW."payload" -> 'tailoring') t,
      jsonb_array_elements(t.value -> 'sources') s
    UNION ALL
    SELECT s.value FROM jsonb_array_elements(NEW."payload" -> 'proConfirmations') t,
      jsonb_array_elements(t.value -> 'sources') s
  LOOP
    IF NOT ((source ->> 'provenance' = 'CLIENT_REPORTED' AND source ->> 'revisionId' = NEW."clientRevisionId")
      OR (source ->> 'provenance' = 'OBSERVED' AND source ->> 'revisionId' = NEW."analysisRevisionId")) IS TRUE THEN
      RAISE EXCEPTION 'suitability citation must pin its source revision' USING ERRCODE = '23514';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$function$;
CREATE TRIGGER "consult_suitability_translation_guard" BEFORE INSERT OR UPDATE ON "ConsultSuitabilityTranslation"
FOR EACH ROW EXECUTE FUNCTION public.consult_suitability_translation_guard();
