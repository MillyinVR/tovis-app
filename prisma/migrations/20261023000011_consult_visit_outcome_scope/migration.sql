-- Completed feedback is generated only by the booking completion trigger.
-- Independent foreign keys alone would allow mixing another client's brief
-- with a booking; bind all three identities and the completion snapshot.
CREATE FUNCTION public.consult_visit_outcome_scope_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF pg_trigger_depth() < 2 OR NOT EXISTS (
    SELECT 1 FROM public."Booking" b
    JOIN public."ConsultSession" s ON s.id = NEW."consultSessionId"
    JOIN public."ConsultLookBriefVersion" v ON v.id = NEW."lookBriefVersionId" AND v."consultSessionId" = s.id
    WHERE b.id = NEW."bookingId" AND b.status = 'COMPLETED'
      AND (b."sourceConsultSessionId" = s.id OR s."bookingId" = b.id)
      AND b."clientId" = s."clientId" AND b."professionalId" = s."professionalId"
      AND NEW.id = 'consult-visit:' || b.id
      AND NEW."finalServiceSubtotal" IS NOT DISTINCT FROM b."serviceSubtotalSnapshot"
  ) THEN
    RAISE EXCEPTION 'completed consultation feedback requires its completed booking and own brief' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "ConsultLookVisitOutcome_scope" BEFORE INSERT ON public."ConsultLookVisitOutcome"
  FOR EACH ROW EXECUTE FUNCTION public.consult_visit_outcome_scope_guard();
