-- Additive, private evidence. Existing analysis/brief payloads remain readable.
ALTER TYPE "ConsultProviderCallKind" ADD VALUE 'ANALYSIS_HAIR_MAP';

CREATE TABLE "ConsultHairComparison" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "consultSessionId" TEXT NOT NULL REFERENCES "ConsultSession"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "analysisRevisionId" TEXT NOT NULL REFERENCES "ConsultRevision"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "requestHash" CHAR(64) NOT NULL,
  "schemaVersion" INTEGER NOT NULL,
  "promptVersion" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ConsultHairComparison_version" CHECK ((
    "schemaVersion" = 1 AND "promptVersion" = 'hair-map-v1'
    AND "payload" ->> 'schemaVersion' = '1'
    AND "payload" ->> 'promptVersion' = "promptVersion"
  ) IS TRUE),
  CONSTRAINT "ConsultHairComparison_shape" CHECK ((
    jsonb_typeof("payload") = 'object'
    AND "payload" ?& ARRAY['schemaVersion','promptVersion','current','reference','inspirationId','captures']
    AND "payload" - ARRAY['schemaVersion','promptVersion','current','reference','inspirationId','captures'] = '{}'::jsonb
    AND jsonb_typeof("payload" -> 'current') = 'object'
    AND jsonb_typeof("payload" -> 'reference') = 'object'
    AND jsonb_array_length("payload" -> 'captures') BETWEEN 1 AND 7
    AND octet_length("payload"::text) <= 100000
    AND length(btrim("payload" ->> 'inspirationId')) > 0
    AND length("model") BETWEEN 1 AND 128 AND btrim("model") = "model"
    AND "requestHash" ~ '^[0-9a-f]{64}$'
  ) IS TRUE)
);
CREATE UNIQUE INDEX "ConsultHairComparison_analysisRevisionId_key" ON "ConsultHairComparison"("analysisRevisionId");
CREATE INDEX "ConsultHairComparison_consultSessionId_createdAt_idx" ON "ConsultHairComparison"("consultSessionId", "createdAt");
ALTER TABLE "ConsultHairComparison" ENABLE ROW LEVEL SECURITY;

CREATE FUNCTION public.consult_hair_comparison_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path TO '' AS $function$
DECLARE
  analysis_row public."ConsultRevision"%ROWTYPE;
  capture JSONB;
  map JSONB;
  zone JSONB;
  observation JSONB;
  evidence JSONB;
  role TEXT;
  views TEXT[] := ARRAY[]::TEXT[];
  ids TEXT[] := ARRAY[]::TEXT[];
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'hair comparisons are immutable' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO analysis_row FROM public."ConsultRevision" WHERE "id" = NEW."analysisRevisionId";
  IF analysis_row."kind" IS DISTINCT FROM 'ANALYSIS'
    OR analysis_row."consultSessionId" IS DISTINCT FROM NEW."consultSessionId"
    OR analysis_row."requestHash" IS DISTINCT FROM NEW."requestHash" THEN
    RAISE EXCEPTION 'hair comparison must pin its same-session analysis inputs' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public."ConsultInspiration" WHERE "id" = NEW."payload" ->> 'inspirationId' AND "consultSessionId" = NEW."consultSessionId") THEN
    RAISE EXCEPTION 'hair comparison reference belongs to another session' USING ERRCODE = '23514';
  END IF;
  FOR capture IN SELECT value FROM jsonb_array_elements(NEW."payload" -> 'captures') LOOP
    IF NOT (capture ?& ARRAY['id','shotKey'] AND capture - ARRAY['id','shotKey'] = '{}'::jsonb
      AND capture ->> 'shotKey' IN ('early_photo','hair_back','hair_left','hair_right','hair_crown','face_front','face_side')) IS TRUE
      OR capture ->> 'id' = ANY(ids) OR capture ->> 'shotKey' = ANY(views)
      OR NOT EXISTS (SELECT 1 FROM public."ConsultCapture" WHERE "id" = capture ->> 'id'
        AND "consultSessionId" = NEW."consultSessionId" AND "shotKey" = capture ->> 'shotKey') THEN
      RAISE EXCEPTION 'hair comparison capture scope is invalid' USING ERRCODE = '23514';
    END IF;
    ids := array_append(ids, capture ->> 'id');
    views := array_append(views, capture ->> 'shotKey');
  END LOOP;
  FOREACH role IN ARRAY ARRAY['current','reference'] LOOP
    map := NEW."payload" -> role;
    IF NOT (map ?& ARRAY['zones','shape'] AND map - ARRAY['zones','shape'] = '{}'::jsonb
      AND map -> 'zones' ?& ARRAY['roots','mids','ends','faceFrame']
      AND (map -> 'zones') - ARRAY['roots','mids','ends','faceFrame'] = '{}'::jsonb
      AND map -> 'shape' ?& ARRAY['length','perimeter','layers','apparentFullness','texture','finish','dimension','visibleGray']
      AND (map -> 'shape') - ARRAY['length','perimeter','layers','apparentFullness','texture','finish','dimension','visibleGray'] = '{}'::jsonb) IS TRUE THEN
      RAISE EXCEPTION 'hair map fields are invalid' USING ERRCODE = '23514';
    END IF;
    FOR zone IN SELECT value FROM jsonb_each(map -> 'zones') LOOP
      IF NOT (zone ?& ARRAY['level','tone','pattern'] AND zone - ARRAY['level','tone','pattern'] = '{}'::jsonb) IS TRUE THEN
        RAISE EXCEPTION 'hair map zone is invalid' USING ERRCODE = '23514';
      END IF;
    END LOOP;
    FOR observation IN
      SELECT o.value FROM jsonb_each(map -> 'zones') z, jsonb_each(z.value) o
      UNION ALL SELECT value FROM jsonb_each(map -> 'shape')
    LOOP
      IF NOT (observation ?& ARRAY['value','confidence','evidence'] AND observation - ARRAY['value','confidence','evidence'] = '{}'::jsonb
        AND jsonb_typeof(observation -> 'value') = 'string'
        AND length(observation ->> 'value') BETWEEN 1 AND 32
        AND observation ->> 'value' ~ '^[A-Z][A-Z0-9_]*$'
        AND (observation -> 'confidence') ?& ARRAY['min','max']
        AND (observation -> 'confidence') - ARRAY['min','max'] = '{}'::jsonb
        AND jsonb_typeof(observation -> 'evidence') = 'array'
        AND jsonb_array_length(observation -> 'evidence') <= 7
        AND jsonb_typeof(observation #> '{confidence,min}') = 'number'
        AND jsonb_typeof(observation #> '{confidence,max}') = 'number'
        AND (observation #>> '{confidence,min}')::numeric >= 0
        AND (observation #>> '{confidence,max}')::numeric <= 1
        AND (observation #>> '{confidence,min}')::numeric <= (observation #>> '{confidence,max}')::numeric
        AND CASE WHEN observation ->> 'value' = 'UNKNOWN' THEN
          jsonb_array_length(observation -> 'evidence') = 0 AND (observation #>> '{confidence,max}')::numeric <= 0.35
          ELSE jsonb_array_length(observation -> 'evidence') > 0 END) IS TRUE THEN
        RAISE EXCEPTION 'hair map observation is invalid' USING ERRCODE = '23514';
      END IF;
      FOR evidence IN SELECT value FROM jsonb_array_elements(observation -> 'evidence') LOOP
        IF NOT (evidence ?& ARRAY['view','region'] AND evidence - ARRAY['view','region'] = '{}'::jsonb
          AND (evidence -> 'region') ?& ARRAY['x','y','w','h']
          AND (evidence -> 'region') - ARRAY['x','y','w','h'] = '{}'::jsonb
          AND jsonb_typeof(evidence #> '{region,x}') = 'number'
          AND jsonb_typeof(evidence #> '{region,y}') = 'number'
          AND jsonb_typeof(evidence #> '{region,w}') = 'number'
          AND jsonb_typeof(evidence #> '{region,h}') = 'number'
          AND (evidence #>> '{region,x}')::numeric >= 0 AND (evidence #>> '{region,y}')::numeric >= 0
          AND (evidence #>> '{region,w}')::numeric > 0 AND (evidence #>> '{region,h}')::numeric > 0
          AND (evidence #>> '{region,x}')::numeric + (evidence #>> '{region,w}')::numeric <= 1
          AND (evidence #>> '{region,y}')::numeric + (evidence #>> '{region,h}')::numeric <= 1
          AND CASE WHEN role = 'reference' THEN evidence ->> 'view' = 'inspiration' ELSE evidence ->> 'view' = ANY(views) END) IS TRUE THEN
          RAISE EXCEPTION 'hair map evidence crosses its source scope' USING ERRCODE = '23514';
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;
  RETURN NEW;
END;
$function$;
CREATE TRIGGER "consult_hair_comparison_guard" BEFORE INSERT OR UPDATE ON "ConsultHairComparison"
FOR EACH ROW EXECUTE FUNCTION public.consult_hair_comparison_guard();
