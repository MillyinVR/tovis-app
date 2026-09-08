CREATE TABLE public."ConsultAnalysisChartPhoto" (
  "revisionId" text NOT NULL REFERENCES public."ConsultRevision"(id) ON DELETE CASCADE,
  "photoUseId" text NOT NULL REFERENCES public."ConsultChartPhotoUse"(id) ON DELETE CASCADE,
  PRIMARY KEY ("revisionId", "photoUseId")
);
ALTER TABLE public."ConsultAnalysisChartPhoto" ENABLE ROW LEVEL SECURITY;
CREATE FUNCTION public.consult_analysis_chart_photo_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE revision public."ConsultRevision"; source_session text;
BEGIN
  IF TG_OP = 'UPDATE' THEN RAISE EXCEPTION 'chart photo provenance is immutable' USING ERRCODE = '23514'; END IF;
  SELECT * INTO revision FROM public."ConsultRevision" WHERE id = NEW."revisionId";
  SELECT "consultSessionId" INTO source_session FROM public."ConsultChartPhotoUse" WHERE id = NEW."photoUseId";
  IF revision.kind <> 'ANALYSIS' OR revision."consultSessionId" IS DISTINCT FROM source_session THEN
    RAISE EXCEPTION 'chart photo provenance must reference its own analysis' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "ConsultAnalysisChartPhoto_guard" BEFORE INSERT OR UPDATE ON public."ConsultAnalysisChartPhoto"
  FOR EACH ROW EXECUTE FUNCTION public.consult_analysis_chart_photo_guard();
