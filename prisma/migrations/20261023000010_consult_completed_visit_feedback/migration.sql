CREATE TABLE public."ConsultLookVisitOutcome" (
  id text PRIMARY KEY,
  "bookingId" text NOT NULL UNIQUE REFERENCES public."Booking"(id) ON DELETE CASCADE,
  "consultSessionId" text NOT NULL REFERENCES public."ConsultSession"(id) ON DELETE CASCADE,
  "lookBriefVersionId" text NOT NULL REFERENCES public."ConsultLookBriefVersion"(id) ON DELETE CASCADE,
  "observedServiceMinutes" integer CHECK ("observedServiceMinutes" BETWEEN 0 AND 1440),
  "finalServiceSubtotal" decimal(10,2) CHECK ("finalServiceSubtotal" >= 0),
  "completedAt" timestamp(3) NOT NULL,
  "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "ConsultLookVisitOutcome_consultSessionId_completedAt_idx" ON public."ConsultLookVisitOutcome"("consultSessionId","completedAt");
ALTER TABLE public."ConsultLookVisitOutcome" ENABLE ROW LEVEL SECURITY;

CREATE FUNCTION public.consult_completed_visit_feedback()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE brief public."ConsultLookBriefVersion"; service_start timestamp; service_end timestamp; observed_minutes integer;
BEGIN
  IF NEW.status <> 'COMPLETED' OR OLD.status = 'COMPLETED' THEN RETURN NEW; END IF;
  SELECT v.* INTO brief FROM public."ConsultLookBriefVersion" v
    JOIN public."ConsultSession" s ON s.id = v."consultSessionId"
    WHERE s.id = NEW."sourceConsultSessionId" OR s."bookingId" = NEW.id
    ORDER BY v.version DESC LIMIT 1;
  IF NOT FOUND THEN RETURN NEW; END IF;
  SELECT min("createdAt") INTO service_start FROM public."BookingCloseoutAuditLog"
    WHERE "bookingId" = NEW.id AND action = 'SESSION_STEP_CHANGED'
      AND "newValue"->>'sessionStep' = 'SERVICE_IN_PROGRESS';
  SELECT max("createdAt") INTO service_end FROM public."BookingCloseoutAuditLog"
    WHERE "bookingId" = NEW.id AND action = 'SESSION_STEP_CHANGED'
      AND "oldValue"->>'sessionStep' = 'SERVICE_IN_PROGRESS'
      AND "newValue"->>'sessionStep' <> 'SERVICE_IN_PROGRESS';
  -- Missing/invalid timing stays unknown. Never substitute reserved duration.
  IF service_start IS NOT NULL AND service_end >= service_start AND service_end <= service_start + interval '24 hours' THEN
    observed_minutes := ceil(extract(epoch FROM service_end - service_start) / 60);
  END IF;
  INSERT INTO public."ConsultLookVisitOutcome" (id,"bookingId","consultSessionId","lookBriefVersionId",
    "observedServiceMinutes","finalServiceSubtotal","completedAt")
    VALUES ('consult-visit:' || NEW.id,NEW.id,brief."consultSessionId",brief.id,observed_minutes,NEW."serviceSubtotalSnapshot",coalesce(NEW."finishedAt",CURRENT_TIMESTAMP))
    ON CONFLICT ("bookingId") DO NOTHING;
  RETURN NEW;
END $$;
CREATE TRIGGER "Booking_consult_completed_visit_feedback" AFTER UPDATE OF status ON public."Booking"
  FOR EACH ROW EXECUTE FUNCTION public.consult_completed_visit_feedback();
CREATE FUNCTION public.consult_visit_outcome_immutable()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN RAISE EXCEPTION 'completed consultation visit feedback is immutable' USING ERRCODE = '23514'; END $$;
CREATE TRIGGER "ConsultLookVisitOutcome_immutable" BEFORE UPDATE ON public."ConsultLookVisitOutcome"
  FOR EACH ROW EXECUTE FUNCTION public.consult_visit_outcome_immutable();
