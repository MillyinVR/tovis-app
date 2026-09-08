ALTER TABLE public."ConsultLookBriefVersion" ADD COLUMN "awaitingAnalysis" BOOLEAN NOT NULL DEFAULT false;

-- Confirmations may only attach to a current, selected, reviewed plan.
CREATE OR REPLACE FUNCTION public.consult_look_brief_acknowledgment_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  PERFORM 1 FROM public."ConsultSession" WHERE id = NEW."consultSessionId" FOR UPDATE;
  IF NEW."clientAcknowledgedAt" IS DISTINCT FROM OLD."clientAcknowledgedAt"
    OR NEW."professionalAcknowledgedAt" IS DISTINCT FROM OLD."professionalAcknowledgedAt" THEN
    IF NEW."awaitingAnalysis" OR NEW."selectedPathIndex" IS NULL
      OR NEW.version <> (SELECT max(version) FROM public."ConsultLookBriefVersion" WHERE "consultSessionId" = NEW."consultSessionId")
      OR NEW."sourceAnalysisRevisionId" IS DISTINCT FROM (SELECT id FROM public."ConsultRevision"
        WHERE "consultSessionId" = NEW."consultSessionId" AND kind = 'ANALYSIS' ORDER BY revision DESC LIMIT 1) THEN
      RAISE EXCEPTION 'only the current selected look version may be confirmed' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "ConsultLookBriefVersion_acknowledgment_guard"
  BEFORE UPDATE ON public."ConsultLookBriefVersion" FOR EACH ROW EXECUTE FUNCTION public.consult_look_brief_acknowledgment_guard();
