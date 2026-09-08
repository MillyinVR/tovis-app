-- AlterEnum
ALTER TYPE "ConsultServiceEstimateRefusalCode" ADD VALUE 'LOOK_PLAN_SELECTION_REQUIRED';

-- AlterEnum
ALTER TYPE "ConsultServiceEstimateLineSource" ADD VALUE 'LOOK_PLAN_REQUIRED';

-- DropIndex
DROP INDEX "ConsultServiceEstimate_consultSessionId_sourceAnalysisRevisionId_key";

-- AlterTable
ALTER TABLE "ConsultServiceEstimate" ADD COLUMN     "sourceLookBriefVersionId" TEXT;

-- CreateTable
CREATE TABLE "ConsultLookBriefVersion" (
    "id" TEXT NOT NULL,
    "consultSessionId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "sourceAnalysisRevisionId" TEXT NOT NULL,
    "selectedPathIndex" INTEGER,
    "adjustments" JSONB NOT NULL DEFAULT '{}',
    "invalidatedAdjustments" JSONB NOT NULL DEFAULT '[]',
    "changeSummary" JSONB NOT NULL DEFAULT '[]',
    "createdByActorType" "ConsultActorType" NOT NULL,
    "createdByActorId" TEXT,
    "clientAcknowledgedAt" TIMESTAMP(3),
    "professionalAcknowledgedAt" TIMESTAMP(3),
    "idempotencyKey" VARCHAR(128) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConsultLookBriefVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ConsultLookBriefVersion_sourceAnalysisRevisionId_idx" ON "ConsultLookBriefVersion"("sourceAnalysisRevisionId");

-- CreateIndex
CREATE UNIQUE INDEX "ConsultLookBriefVersion_consultSessionId_version_key" ON "ConsultLookBriefVersion"("consultSessionId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "ConsultLookBriefVersion_consultSessionId_idempotencyKey_key" ON "ConsultLookBriefVersion"("consultSessionId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "ConsultServiceEstimate_sourceLookBriefVersionId_key" ON "ConsultServiceEstimate"("sourceLookBriefVersionId");

-- CreateIndex
CREATE INDEX "ConsultServiceEstimate_consultSessionId_sourceAnalysisRevis_idx" ON "ConsultServiceEstimate"("consultSessionId", "sourceAnalysisRevisionId");

-- AddForeignKey
ALTER TABLE "ConsultServiceEstimate" ADD CONSTRAINT "ConsultServiceEstimate_sourceLookBriefVersionId_fkey" FOREIGN KEY ("sourceLookBriefVersionId") REFERENCES "ConsultLookBriefVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsultLookBriefVersion" ADD CONSTRAINT "ConsultLookBriefVersion_consultSessionId_fkey" FOREIGN KEY ("consultSessionId") REFERENCES "ConsultSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsultLookBriefVersion" ADD CONSTRAINT "ConsultLookBriefVersion_sourceAnalysisRevisionId_fkey" FOREIGN KEY ("sourceAnalysisRevisionId") REFERENCES "ConsultRevision"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Retain the old one-estimate-per-analysis rule for historical writers.
CREATE UNIQUE INDEX "ConsultServiceEstimate_legacy_analysis_key"
  ON "ConsultServiceEstimate"("consultSessionId", "sourceAnalysisRevisionId")
  WHERE "sourceLookBriefVersionId" IS NULL;

ALTER TABLE "ConsultLookBriefVersion"
  ADD CONSTRAINT "ConsultLookBriefVersion_shape" CHECK (
    version > 0 AND ("selectedPathIndex" IS NULL OR "selectedPathIndex" BETWEEN 0 AND 2)
    AND jsonb_typeof(adjustments) = 'object'
    AND jsonb_typeof("invalidatedAdjustments") = 'array'
    AND jsonb_typeof("changeSummary") = 'array'
    AND length("idempotencyKey") BETWEEN 1 AND 128
    AND ("clientAcknowledgedAt" IS NULL OR "clientAcknowledgedAt" >= "createdAt")
    AND ("professionalAcknowledgedAt" IS NULL OR "professionalAcknowledgedAt" >= "createdAt")
  );

CREATE OR REPLACE FUNCTION public.consult_look_brief_version_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE source_payload jsonb; next_version integer;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF (to_jsonb(NEW) - ARRAY['clientAcknowledgedAt','professionalAcknowledgedAt'])
      IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['clientAcknowledgedAt','professionalAcknowledgedAt'])
      OR (OLD."clientAcknowledgedAt" IS NOT NULL AND NEW."clientAcknowledgedAt" IS DISTINCT FROM OLD."clientAcknowledgedAt")
      OR (OLD."professionalAcknowledgedAt" IS NOT NULL AND NEW."professionalAcknowledgedAt" IS DISTINCT FROM OLD."professionalAcknowledgedAt")
    THEN RAISE EXCEPTION 'look brief versions are immutable; confirmations belong to their exact version' USING ERRCODE = '23514'; END IF;
    RETURN NEW;
  END IF;
  PERFORM 1 FROM public."ConsultSession" WHERE id = NEW."consultSessionId" FOR UPDATE;
  SELECT COALESCE(max(version),0) + 1 INTO next_version
    FROM public."ConsultLookBriefVersion" WHERE "consultSessionId" = NEW."consultSessionId";
  SELECT payload INTO source_payload FROM public."ConsultRevision"
    WHERE id = NEW."sourceAnalysisRevisionId" AND "consultSessionId" = NEW."consultSessionId"
      AND kind = 'ANALYSIS' AND "schemaVersion" = 6;
  IF NEW.version <> next_version OR source_payload IS NULL OR NOT source_payload ? 'lookPlan'
    OR (NEW."selectedPathIndex" IS NOT NULL AND
      (source_payload #>> '{lookPlan,status}' <> 'READY_TO_CHOOSE'
       OR NEW."selectedPathIndex" >= jsonb_array_length(source_payload #> '{lookPlan,paths}')))
  THEN RAISE EXCEPTION 'look brief version requires its own current analysis and valid path' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "ConsultLookBriefVersion_guard" BEFORE INSERT OR UPDATE ON "ConsultLookBriefVersion"
  FOR EACH ROW EXECUTE FUNCTION public.consult_look_brief_version_guard();

-- A new estimate contains every required step of visit one and no reference
-- photo floor. Alternatives and later visits cannot lengthen that appointment.
CREATE OR REPLACE FUNCTION public.consult_look_estimate_lines_valid(estimate_id text)
RETURNS boolean LANGUAGE plpgsql STABLE SET search_path = '' AS $$
DECLARE estimate public."ConsultServiceEstimate"; brief public."ConsultLookBriefVersion";
  selected_steps jsonb; item jsonb; item_order bigint; actual_count integer;
BEGIN
  SELECT * INTO estimate FROM public."ConsultServiceEstimate" WHERE id = estimate_id;
  IF NOT FOUND OR estimate."sourceLookBriefVersionId" IS NULL THEN RETURN true; END IF;
  SELECT * INTO brief FROM public."ConsultLookBriefVersion" WHERE id = estimate."sourceLookBriefVersionId";
  IF NOT FOUND OR brief."consultSessionId" <> estimate."consultSessionId"
    OR brief."sourceAnalysisRevisionId" <> estimate."sourceAnalysisRevisionId" THEN RETURN false; END IF;
  SELECT count(*) INTO actual_count FROM public."ConsultServiceEstimateLine" WHERE "estimateId" = estimate_id;
  IF estimate.status = 'REFUSED' THEN RETURN actual_count = 0; END IF;
  IF brief."selectedPathIndex" IS NULL THEN RETURN false; END IF;
  SELECT payload #> ARRAY['lookPlan','paths',brief."selectedPathIndex"::text,'visits','0','steps']
    INTO selected_steps FROM public."ConsultRevision" WHERE id = brief."sourceAnalysisRevisionId";
  IF selected_steps IS NULL OR jsonb_typeof(selected_steps) <> 'array'
    OR actual_count <> jsonb_array_length(selected_steps) OR actual_count = 0 THEN RETURN false; END IF;
  FOR item, item_order IN SELECT value, ordinality FROM jsonb_array_elements(selected_steps) WITH ORDINALITY LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public."ConsultServiceEstimateLine" l WHERE l."estimateId" = estimate_id
        AND l."sortOrder" = item_order - 1 AND l."serviceId" = item->>'serviceId'
        AND l."offeringId" = item->>'offeringId' AND l.source::text = 'LOOK_PLAN_REQUIRED'
    ) THEN RETURN false; END IF;
  END LOOP;
  RETURN true;
END $$;

CREATE OR REPLACE FUNCTION public.consult_look_estimate_line_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NOT public.consult_look_estimate_lines_valid(NEW."estimateId") THEN
    RAISE EXCEPTION 'look estimate must contain exactly the selected first visit' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER "ConsultServiceEstimateLine_look_plan_shape"
  AFTER INSERT ON "ConsultServiceEstimateLine" DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.consult_look_estimate_line_guard();

DO $patch$
DECLARE definition text; marker text;
BEGIN
  SELECT pg_get_functiondef('public.consult_service_estimate_line_shape()'::regprocedure) INTO definition;
  marker := '  IF estimate_status = ''ESTIMATED'' AND floor_count <> 1 THEN';
  IF position(marker IN definition) = 0 THEN RAISE EXCEPTION 'Expected legacy estimate floor guard was not found'; END IF;
  definition := replace(definition, marker, $body$
  IF EXISTS (SELECT 1 FROM public."ConsultServiceEstimate" WHERE id = NEW.id AND "sourceLookBriefVersionId" IS NOT NULL) THEN
    IF NOT public.consult_look_estimate_lines_valid(NEW.id) THEN
      RAISE EXCEPTION 'look estimate must contain exactly the selected first visit' USING ERRCODE = '23514';
    END IF;
    RETURN NULL;
  END IF;
  IF estimate_status = 'ESTIMATED' AND floor_count <> 1 THEN
$body$);
  EXECUTE definition;
  SELECT pg_get_functiondef('public.consult_service_estimate_immutable()'::regprocedure) INTO definition;
  definition := replace(definition, 'IF NEW."consultSessionId" IS DISTINCT FROM OLD."consultSessionId"',
    'IF NEW."sourceLookBriefVersionId" IS DISTINCT FROM OLD."sourceLookBriefVersionId" OR NEW."consultSessionId" IS DISTINCT FROM OLD."consultSessionId"');
  EXECUTE definition;
END $patch$;
