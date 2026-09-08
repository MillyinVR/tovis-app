CREATE TABLE public."ConsultChartReview" (
  id text PRIMARY KEY,
  "consultSessionId" text NOT NULL REFERENCES public."ConsultSession"(id) ON DELETE CASCADE,
  "intakeRevisionId" text NOT NULL UNIQUE REFERENCES public."ConsultRevision"(id) ON DELETE CASCADE,
  fingerprint char(64) NOT NULL CHECK (fingerprint ~ '^[a-f0-9]{64}$'),
  decision varchar(16) NOT NULL CHECK (decision IN ('CONFIRMED', 'CHANGED')),
  facts jsonb NOT NULL CHECK (jsonb_typeof(facts) = 'array' AND jsonb_array_length(facts) <= 12),
  "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "ConsultChartReview_consultSessionId_createdAt_idx" ON public."ConsultChartReview"("consultSessionId", "createdAt");
ALTER TABLE public."ConsultChartReview" ENABLE ROW LEVEL SECURITY;
CREATE FUNCTION public.consult_chart_review_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE revision public."ConsultRevision";
BEGIN
  IF TG_OP = 'UPDATE' THEN RAISE EXCEPTION 'chart reviews are immutable' USING ERRCODE = '23514'; END IF;
  SELECT * INTO revision FROM public."ConsultRevision" WHERE id = NEW."intakeRevisionId";
  IF revision."consultSessionId" IS DISTINCT FROM NEW."consultSessionId" OR revision.kind <> 'INTAKE' THEN
    RAISE EXCEPTION 'chart review must reference its own intake revision' USING ERRCODE = '23514';
  END IF;
  IF NEW.decision = 'CHANGED' AND jsonb_array_length(NEW.facts) <> 0 THEN
    RAISE EXCEPTION 'changed chart review cannot confirm facts' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "ConsultChartReview_guard" BEFORE INSERT OR UPDATE ON public."ConsultChartReview"
  FOR EACH ROW EXECUTE FUNCTION public.consult_chart_review_guard();
