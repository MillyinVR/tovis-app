-- Mirror the canonical service-start boundary for alternate database writers.
CREATE OR REPLACE FUNCTION public.consult_look_service_start_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE session_id text; brief public."ConsultLookBriefVersion"; estimate jsonb;
BEGIN
  IF NEW."sessionStep" <> 'SERVICE_IN_PROGRESS' OR OLD."sessionStep" = 'SERVICE_IN_PROGRESS' THEN RETURN NEW; END IF;
  SELECT s.id INTO session_id FROM public."ConsultSession" s
    WHERE s.id = NEW."sourceConsultSessionId" OR s."bookingId" = NEW.id LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN RETURN NEW; END IF;
  SELECT * INTO brief FROM public."ConsultLookBriefVersion"
    WHERE "consultSessionId" = session_id ORDER BY version DESC LIMIT 1;
  IF NOT FOUND THEN RETURN NEW; END IF;
  IF brief."awaitingAnalysis" OR brief."invalidatedProfessionalPlan" IS NOT NULL
    OR jsonb_array_length(brief."invalidatedAdjustments") > 0
    OR brief."clientAcknowledgedAt" IS NULL OR brief."professionalAcknowledgedAt" IS NULL
    OR brief."selectedPathIndex" IS NULL OR brief."selectedLocationType" IS NULL THEN
    RAISE EXCEPTION 'both participants must confirm the current look brief before service' USING ERRCODE = '23514';
  END IF;
  SELECT item INTO estimate FROM jsonb_array_elements(brief."pathEstimates") item
    WHERE (item->>'pathIndex')::integer = brief."selectedPathIndex"
      AND item->>'locationType' = brief."selectedLocationType"::text LIMIT 1;
  IF estimate IS NULL OR estimate->'firstAppointment'->>'price' IS NULL
    OR estimate->'firstAppointment'->>'durationMinutes' IS NULL
    OR (estimate->'firstAppointment'->>'durationMinutes')::integer > NEW."totalDurationMinutes"
    OR NEW."locationType" IS DISTINCT FROM brief."selectedLocationType"
    OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(estimate->'visits'->0->'steps'))
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(estimate->'visits'->0->'steps') step
      WHERE NOT EXISTS (SELECT 1 FROM public."BookingServiceItem" item WHERE item."bookingId" = NEW.id
        AND item."offeringId" = step->>'offeringId'
        AND item."priceSnapshot" = (step->>'price')::numeric)) THEN
    RAISE EXCEPTION 'reserved appointment must cover the confirmed look work, agreed prices and time' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
