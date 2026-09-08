-- New look proposals preserve every required step of the selected first visit.
-- Historical proposals retain their one linked-service floor.
CREATE OR REPLACE FUNCTION public."consult_booking_proposal_totals"()
RETURNS TRIGGER AS $$
DECLARE
  proposal public."ConsultBookingProposal"%ROWTYPE;
  estimate public."ConsultServiceEstimate"%ROWTYPE;
  line_count INTEGER;
  floor_count INTEGER;
  duration_sum INTEGER;
  price_sum NUMERIC;
BEGIN
  SELECT * INTO proposal FROM public."ConsultBookingProposal" WHERE "id" = NEW."id";
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO estimate FROM public."ConsultServiceEstimate" WHERE "id" = proposal."estimateId";
  SELECT count(*), count(*) FILTER (WHERE "source" = 'LOOK_LINKED_SERVICE'),
    coalesce(sum("durationMinutes"), 0), coalesce(sum("price"), 0)
    INTO line_count, floor_count, duration_sum, price_sum
    FROM public."ConsultBookingProposalLine" WHERE "proposalId" = proposal."id";
  IF line_count = 0 OR proposal."totalDurationMinutes" IS DISTINCT FROM duration_sum
    OR proposal."startingAtPrice" IS DISTINCT FROM price_sum THEN
    RAISE EXCEPTION 'a booking proposal must equal its nonempty lines' USING ERRCODE = '23514';
  END IF;
  IF estimate."sourceLookBriefVersionId" IS NULL THEN
    IF floor_count <> 1 OR EXISTS (SELECT 1 FROM public."ConsultBookingProposalLine"
      WHERE "proposalId" = proposal."id" AND "source" = 'LOOK_PLAN_REQUIRED') THEN
      RAISE EXCEPTION 'a legacy proposal must carry exactly one floor' USING ERRCODE = '23514';
    END IF;
  ELSE
    IF floor_count <> 0 OR proposal."locationType" IS DISTINCT FROM estimate."locationType"
      OR line_count <> (SELECT count(*) FROM public."ConsultServiceEstimateLine" WHERE "estimateId" = estimate."id")
      OR EXISTS (SELECT 1 FROM public."ConsultBookingProposalLine" line
        LEFT JOIN public."ConsultServiceEstimateLine" required ON required."id" = line."estimateLineId"
        WHERE line."proposalId" = proposal."id" AND (
          required."estimateId" IS DISTINCT FROM estimate."id"
          OR line."source" IS DISTINCT FROM 'LOOK_PLAN_REQUIRED'
          OR required."source" IS DISTINCT FROM 'LOOK_PLAN_REQUIRED'
          OR line."serviceId" IS DISTINCT FROM required."serviceId"
          OR line."offeringId" IS DISTINCT FROM required."offeringId"
          OR line."sortOrder" IS DISTINCT FROM required."sortOrder")) THEN
      RAISE EXCEPTION 'a look proposal must retain the selected visit and mode' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SET search_path = '';
